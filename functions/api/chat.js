import { json, error, exigirUsuario, leerAjustes } from "../_lib/util.js";
import { promptChat } from "../_lib/prompts.js";
import {
    armarContenidos,
    validarAdjuntos,
    sumarAdjuntos,
    abrirStream,
    transmitir
} from "../_lib/gemini.js";
import { manejarChatInvitado } from "../_lib/chat-invitado.js";
import {
    buscarConversacion,
    crearConversacion,
    insertarMensaje,
    tocarConversacion,
    tituloDesde
} from "../_lib/conversaciones.js";

const LIMITE_DIARIO_POR_DEFECTO = 200;
const MAX_CARACTERES_MENSAJE = 8000;
const MAX_MENSAJES_HISTORIAL = 40;

export async function onRequestPost(context) {
    const { request, env } = context;

    // Sin cuentas (el modo por defecto): el historial vive en el navegador.
    if (env.MODO_CUENTAS !== "si") {
        return manejarChatInvitado(context);
    }

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
            sumarAdjuntos(contents, adjuntosOk.lista);
        }

        const ajustes = leerAjustes(usuario.ajustes);
        const instruccion = promptChat({ usuario, ajustes, ahora: new Date() });

        // ---- Respuesta en streaming ----

        const flujo = abrirStream();

        const trabajo = (async () => {
            try {
                await flujo.enviar({
                    t: "inicio",
                    conversacionId: conversacion.id,
                    titulo: conversacion.titulo
                });

                const resultado = await transmitir({
                    env,
                    contents,
                    instruccion,
                    buscarWeb: ajustes.buscarWeb,
                    enviar: flujo.enviar
                });

                if (resultado.texto.trim()) {
                    await env.DB.batch([
                        insertarMensaje(env, {
                            conversacionId: conversacion.id,
                            rol: "model",
                            contenido: resultado.texto,
                            fuentes: resultado.fuentes
                        }),
                        tocarConversacion(env, conversacion.id)
                    ]);
                }

                if (resultado.clienteSeFue) return;

                if (resultado.error) {
                    await flujo.enviar({ t: "error", mensaje: resultado.error });
                    return;
                }

                await flujo.enviar({ t: "fin", fuentes: resultado.fuentes });

            } catch (e) {
                console.error("Error durante el chat:", e);
                try {
                    await flujo.enviar({ t: "error", mensaje: "Se interrumpió la respuesta. Intenta de nuevo." });
                } catch (e2) { /* el cliente ya no está */ }
            } finally {
                await flujo.cerrar();
            }
        })();

        context.waitUntil(trabajo);

        return flujo.respuesta();

    } catch (e) {
        console.error("Error en /api/chat:", e);
        return json({ error: "No se pudo procesar el mensaje: " + e.message }, 500);
    }
}
