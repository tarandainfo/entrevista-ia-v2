// ========================================
// FUNCIONES COMPARTIDAS CON GEMINI
// ========================================
//
// Las usan los dos modos del chat: con cuentas (guarda el historial
// en la base de datos) y sin cuentas (el historial vive en el navegador).

export const MAX_ADJUNTOS = 4;
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

// Pide la respuesta a Gemini y la va "transmitiendo" con enviar().
// Devuelve el texto completo, las fuentes y, si falló, el motivo.
export async function transmitir({ env, contents, instruccion, buscarWeb, enviar }) {
    let texto = "";
    const fuentes = new Map();
    let clienteSeFue = false;
    let motivoVacio = "";

    const upstream = await llamarGemini({
        env,
        contents,
        systemInstruction: instruccion,
        buscarWeb
    });

    if (!upstream.ok || !upstream.body) {
        const detalle = await upstream.text().catch(() => "");
        console.error("Gemini respondió con error:", upstream.status, detalle.slice(0, 500));
        return {
            texto: "",
            fuentes: [],
            clienteSeFue: false,
            error: "No pude comunicarme con el modelo en este momento. Intenta de nuevo."
        };
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
            texto += delta;

            try {
                await enviar({ t: "delta", texto: delta });
            } catch (e) {
                clienteSeFue = true;
                break;
            }
        }
    }

    return {
        texto,
        fuentes: Array.from(fuentes.values()).slice(0, 8),
        clienteSeFue,
        error: texto.trim() ? null : (motivoVacio || "No recibí una respuesta del modelo. Intenta de nuevo.")
    };
}

// ----------------------------------------
// Historial y adjuntos
// ----------------------------------------

// Junta mensajes seguidos del mismo rol y exige empezar por la persona.
export function armarContenidos(historial) {
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

    while (contenidos.length && contenidos[0].role !== "user") {
        contenidos.shift();
    }

    return contenidos;
}

export function validarAdjuntos(adjuntos) {
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

// Agrega los adjuntos al último mensaje de la persona.
export function sumarAdjuntos(contents, adjuntos) {
    const partes = contents[contents.length - 1].parts;

    for (const a of adjuntos) {
        if (a.texto !== undefined) {
            partes.push({ text: `Contenido del archivo "${a.nombre}":\n${a.texto}` });
        } else {
            partes.push({ inlineData: { mimeType: a.mime, data: a.base64 } });
        }
    }
}

// ----------------------------------------
// Respuesta en streaming (SSE)
// ----------------------------------------

export function abrirStream() {
    const { readable, writable } = new TransformStream();
    const escritor = writable.getWriter();
    const codificador = new TextEncoder();

    return {
        enviar: (obj) => escritor.write(codificador.encode(`data: ${JSON.stringify(obj)}\n\n`)),
        cerrar: async () => { try { await escritor.close(); } catch (e) { /* ya cerrado */ } },
        respuesta: () => new Response(readable, {
            headers: {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-store",
                "X-Accel-Buffering": "no"
            }
        })
    };
}

// ----------------------------------------
// Límite por dirección (solo en el modo sin cuentas)
// ----------------------------------------
//
// Es un freno "de mejor esfuerzo": vive en la memoria de cada
// instancia del servidor. Frena abusos obvios, pero no es una
// barrera perfecta. Con cuentas el límite es por persona y exacto.

const registros = new Map();

export function permitir(request, clave, maximo, ventanaMs) {
    const direccion =
        request.headers.get("CF-Connecting-IP") ||
        (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim() ||
        "local";

    const id = `${clave}:${direccion}`;
    const ahora = Date.now();
    const recientes = (registros.get(id) || []).filter((t) => ahora - t < ventanaMs);

    if (recientes.length >= maximo) {
        registros.set(id, recientes);
        return false;
    }

    recientes.push(ahora);
    registros.set(id, recientes);

    if (registros.size > 5000) {
        for (const [k, lista] of registros) {
            if (!lista.length || ahora - lista[lista.length - 1] > ventanaMs) registros.delete(k);
        }
    }

    return true;
}
