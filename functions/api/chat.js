import { json, error, exigirUsuario, leerAjustes } from "../_lib/util.js";
import { promptChat } from "../_lib/prompts.js";
import {
    buscarConversacion,
    crearConversacion,
    insertarMensaje,
    tocarConversacion,
    tituloDesde
} from "../_lib/conversaciones.js";

// ----------------------------------------
// Límites
// ----------------------------------------

const LIMITE_DIARIO_POR_DEFECTO = 200;
const MAX_CARACTERES_MENSAJE = 8000;
const MAX_MENSAJES_HISTORIAL = 40;
const MAX_ADJUNTOS = 4;
const MAX_BASE64_ADJUNTO = 7 * 1024 * 1024;
const MIMES_BINARIOS = [
    "image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"
];

// ----------------------------------------
// Lectura del stream de eventos (SSE) de Gemini
// ----------------------------------------

async function* leerEventos(cuerpo) {
    const lector = cuerpo.getReader();
    const decodificador = new TextDecoder();
    let pendiente = "";

    try {
        while (true) {
            const { done, value } = await lector.read();
            if (done) break;

            pendiente += decodificador.decode(value, { stream: true });

            let corte;
            while ((corte = pendiente.search(/\r?\n\r?\n/)) !== -1) {
                const bloque = pendiente.slice(0, corte);
                pendiente = pendiente.slice(corte).replace(/^\r?\n\r?\n/, "");
                yield bloque;
            }
        }

        if (pendiente.trim()) yield pendiente;

    } finally {
        try { await lector.cancel(); } catch (e) { /* ya estaba cerrado */ }
    }
}

function datosDelBloque(bloque) {
    const lineas = bloque
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim());

    if (lineas.length === 0) return null;

    try {
        return JSON.parse(lineas.join("\n"));
    } catch (e) {
        return null;
    }
}

// ----------------------------------------
// Llamada a Gemini
// ----------------------------------------

async function llamarGemini({ env, contents, systemInstruction, buscarWeb }) {
    const base = env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com";
    const modelo = env.GEMINI_CHAT_MODEL || "gemini-3.5-flash-lite";
    const url = `${base}/v1beta/models/${modelo}:streamGenerateContent?alt=sse`;

    const cuerpo = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: { maxOutputTokens: 8192 }
    };

    if (buscarWeb) {
        cuerpo.tools = [{ google_search: {} }];
    }

    const pedir = () =>
        fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": env.GEMINI_API_KEY
            },
            body: JSON.stringify(cuerpo)
        });

    let respuesta = await pedir();

    // Si el modelo no acepta la búsqueda web, reintentamos sin ella
    // en lugar de dejar a la persona sin respuesta.
    if (!respuesta.ok && buscarWeb && respuesta.status === 400) {
        console.warn("El modelo rechazó la herramienta de búsqueda; se reintenta sin ella.");
        delete cuerpo.tools;
        respuesta = await pedir();
    }

    return respuesta;
}

// ----------------------------------------
// Armado del historial para el modelo
// ----------------------------------------

function armarContenidos(historial) {
    const contenidos = [];

    for (const m of historial) {
        const rol = m.rol === "model" ? "model" : "user";
        const previo = contenidos[contenidos.length - 1];

        if (previo && previo.role === rol) {
            previo.parts[0].text += "\n\n" + m.contenido;
        } else {
            contenidos.push({ role: rol, parts: [{ text: m.contenido }] });
        }
    }

    // El historial tiene que empezar con un mensaje de la persona.
    while (contenidos.length && contenidos[0].role !== "user") {
        contenidos.shift();
    }

    return contenidos;
}

function validarAdjuntos(adjuntos) {
    if (!Array.isArray(adjuntos)) return { ok: true, lista: [] };
    if (adjuntos.length > MAX_ADJUNTOS) {
        return { ok: false, mensaje: `Puedes adjuntar hasta ${MAX_ADJUNTOS} archivos por mensaje.` };
    }

    const lista = [];

    for (const a of adjuntos) {
        const nombre = String((a && a.nombre) || "archivo").slice(0, 120);

        if (a && typeof a.texto === "string") {
            lista.push({ nombre, texto: a.texto.slice(0, 200000) });
            continue;
        }

        if (a && typeof a.base64 === "string" && MIMES_BINARIOS.includes(a.mime)) {
            if (a.base64.length > MAX_BASE64_ADJUNTO) {
                return { ok: false, mensaje: `El archivo "${nombre}" es demasiado grande.` };
            }
            lista.push({ nombre, mime: a.mime, base64: a.base64 });
            continue;
        }

        return { ok: false, mensaje: `No puedo leer el archivo "${nombre}" (tipo no compatible).` };
    }

    return { ok: true, lista };
}

// ----------------------------------------
// Endpoint
// ----------------------------------------

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const { usuario, respuesta } = await exigirUsuario(context, { mutante: true });
        if (respuesta) return respuesta;

        if (!env.GEMINI_API_KEY) {
            return error("Falta configurar GEMINI_API_KEY en el servidor.", 500);
        }

        let cuerpo;
        try {
            cuerpo = await request.json();
        } catch (e) {
            return error("Pedido inválido.");
        }

        const regenerar = cuerpo.regenerar === true;
        const mensaje = String(cuerpo.mensaje ?? "").trim();
        const adjuntosOk = validarAdjuntos(cuerpo.adjuntos);

        if (!adjuntosOk.ok) return error(adjuntosOk.mensaje);

        if (!regenerar) {
            if (!mensaje && adjuntosOk.lista.length === 0) {
                return error("Escribe un mensaje para LEDA.");
            }
            if (mensaje.length > MAX_CARACTERES_MENSAJE) {
                return error(`El mensaje es muy largo (máximo ${MAX_CARACTERES_MENSAJE} caracteres).`);
            }
        }

        // Límite diario por persona, para cuidar el consumo.
        const limite = Number(env.LIMITE_DIARIO) || LIMITE_DIARIO_POR_DEFECTO;
        const hace24h = Date.now() - 24 * 60 * 60 * 1000;

        const usados = await env.DB
            .prepare(
                `SELECT COUNT(*) AS n
                 FROM mensajes m
                 JOIN conversaciones c ON c.id = m.conversacion_id
                 WHERE c.usuario_id = ? AND m.rol = 'user' AND m.creado >= ?`
            )
            .bind(usuario.id, hace24h)
            .first();

        if (!regenerar && usados && usados.n >= limite) {
            return error(
                "Llegaste al límite de mensajes de hoy. Vuelve a intentarlo mañana.",
                429
            );
        }

        // Conversación: existente o nueva.
        let conversacion;

        if (cuerpo.conversacionId) {
            conversacion = await buscarConversacion(env, String(cuerpo.conversacionId), usuario.id);
            if (!conversacion) return error("No encontré esa conversación.", 404);
        } else {
            if (regenerar) return error("No hay nada para regenerar.");
            conversacion = await crearConversacion(
                env,
                usuario.id,
                tituloDesde(mensaje, adjuntosOk.lista[0] ? adjuntosOk.lista[0].nombre : "Conversación nueva")
            );
        }

        // Regenerar: borramos la última respuesta de LEDA y la volvemos a pedir.
        if (regenerar) {
            const ultimo = await env.DB
                .prepare("SELECT id, rol FROM mensajes WHERE conversacion_id = ? ORDER BY id DESC LIMIT 1")
                .bind(conversacion.id)
                .first();

            if (!ultimo) return error("No hay nada para regenerar.");

            if (ultimo.rol === "model") {
                await env.DB.prepare("DELETE FROM mensajes WHERE id = ?").bind(ultimo.id).run();
            }
        } else {
            const nombresAdjuntos = adjuntosOk.lista.map((a) => a.nombre);
            const contenidoGuardado = nombresAdjuntos.length
                ? `${mensaje}${mensaje ? "\n\n" : ""}[Adjuntos: ${nombresAdjuntos.join(", ")}]`
                : mensaje;

            await env.DB.batch([
                insertarMensaje(env, {
                    conversacionId: conversacion.id,
                    rol: "user",
                    contenido: contenidoGuardado
                }),
                tocarConversacion(env, conversacion.id)
            ]);
        }

        // Historial completo (ya incluye el mensaje nuevo).
        const { results: filas } = await env.DB
            .prepare(
                `SELECT rol, contenido FROM mensajes
                 WHERE conversacion_id = ?
                 ORDER BY id DESC LIMIT ?`
            )
            .bind(conversacion.id, MAX_MENSAJES_HISTORIAL)
            .all();

        const contents = armarContenidos((filas || []).reverse());

        if (contents.length === 0 || contents[contents.length - 1].role !== "user") {
            return error("No hay un mensaje al que responder.");
        }

        // Los adjuntos solo viajan en el mensaje actual.
        if (!regenerar && adjuntosOk.lista.length) {
            const partes = contents[contents.length - 1].parts;

            for (const a of adjuntosOk.lista) {
                if (a.texto !== undefined) {
                    partes.push({ text: `Contenido del archivo "${a.nombre}":\n${a.texto}` });
                } else {
                    partes.push({ inlineData: { mimeType: a.mime, data: a.base64 } });
                }
            }
        }

        const ajustes = leerAjustes(usuario.ajustes);
        const instruccion = promptChat({ usuario, ajustes, ahora: new Date() });

        // ---- Respuesta en streaming ----

        const { readable, writable } = new TransformStream();
        const escritor = writable.getWriter();
        const codificador = new TextEncoder();

        const enviar = (obj) =>
            escritor.write(codificador.encode(`data: ${JSON.stringify(obj)}\n\n`));

        const trabajo = (async () => {
            let textoCompleto = "";
            const fuentes = new Map();
            let clienteSeFue = false;
            let motivoVacio = "";

            try {
                await enviar({
                    t: "inicio",
                    conversacionId: conversacion.id,
                    titulo: conversacion.titulo
                });

                const upstream = await llamarGemini({
                    env,
                    contents,
                    systemInstruction: instruccion,
                    buscarWeb: ajustes.buscarWeb
                });

                if (!upstream.ok || !upstream.body) {
                    const detalle = await upstream.text().catch(() => "");
                    console.error("Gemini respondió con error:", upstream.status, detalle.slice(0, 500));
                    await enviar({
                        t: "error",
                        mensaje: "No pude comunicarme con el modelo en este momento. Intenta de nuevo."
                    });
                    return;
                }

                for await (const bloque of leerEventos(upstream.body)) {
                    const datos = datosDelBloque(bloque);
                    if (!datos) continue;

                    if (datos.promptFeedback && datos.promptFeedback.blockReason) {
                        motivoVacio = "No puedo responder a ese mensaje.";
                    }

                    const candidato = datos.candidates && datos.candidates[0];
                    if (!candidato) continue;

                    const partes = (candidato.content && candidato.content.parts) || [];
                    let delta = "";

                    for (const parte of partes) {
                        if (typeof parte.text === "string" && !parte.thought) {
                            delta += parte.text;
                        }
                    }

                    const chunks =
                        (candidato.groundingMetadata && candidato.groundingMetadata.groundingChunks) || [];

                    for (const chunk of chunks) {
                        if (chunk.web && chunk.web.uri && !fuentes.has(chunk.web.uri)) {
                            fuentes.set(chunk.web.uri, {
                                titulo: chunk.web.title || chunk.web.uri,
                                url: chunk.web.uri
                            });
                        }
                    }

                    if (delta) {
                        textoCompleto += delta;

                        try {
                            await enviar({ t: "delta", texto: delta });
                        } catch (e) {
                            clienteSeFue = true;
                            break;
                        }
                    }
                }

                const listaFuentes = Array.from(fuentes.values()).slice(0, 8);

                if (textoCompleto.trim()) {
                    await env.DB.batch([
                        insertarMensaje(env, {
                            conversacionId: conversacion.id,
                            rol: "model",
                            contenido: textoCompleto,
                            fuentes: listaFuentes
                        }),
                        tocarConversacion(env, conversacion.id)
                    ]);
                }

                if (clienteSeFue) return;

                if (!textoCompleto.trim()) {
                    await enviar({
                        t: "error",
                        mensaje: motivoVacio || "No recibí una respuesta del modelo. Intenta de nuevo."
                    });
                    return;
                }

                await enviar({ t: "fin", fuentes: listaFuentes });

            } catch (e) {
                console.error("Error durante el chat:", e);
                try {
                    await enviar({ t: "error", mensaje: "Se interrumpió la respuesta. Intenta de nuevo." });
                } catch (e2) { /* el cliente ya no está */ }
            } finally {
                try { await escritor.close(); } catch (e) { /* ya cerrado */ }
            }
        })();

        context.waitUntil(trabajo);

        return new Response(readable, {
            headers: {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-store",
                "X-Accel-Buffering": "no"
            }
        });

    } catch (e) {
        console.error("Error en /api/chat:", e);
        return json({ error: "No se pudo procesar el mensaje: " + e.message }, 500);
    }
}
