import { json, error, origenValido } from "./util.js";
import { promptChat } from "./prompts.js";
import {
    armarContenidos,
    validarAdjuntos,
    sumarAdjuntos,
    abrirStream,
    transmitir,
    permitir
} from "./gemini.js";

const MAX_CARACTERES_MENSAJE = 8000;
const MAX_MENSAJES_HISTORIAL = 40;
const MAX_CARACTERES_HISTORIAL = 150000;
const LIMITE_POR_DEFECTO = 40;       // mensajes por dirección...
const VENTANA_MS = 10 * 60 * 1000;   // ...cada 10 minutos

const ESTILOS = ["conciso", "equilibrado", "detallado"];

// Chat sin cuentas: no hay base de datos ni sesión. El navegador manda el
// historial de la conversación en cada pedido y el servidor solo responde.
export async function manejarChatInvitado(context) {
    const { request, env } = context;

    try {
        if (!origenValido(request)) {
            return error("Origen no permitido.", 403);
        }

        if (!env.GEMINI_API_KEY) {
            return error("Falta configurar GEMINI_API_KEY en el servidor.", 500);
        }

        const limite = Number(env.LIMITE_INVITADO) || LIMITE_POR_DEFECTO;

        if (!permitir(request, "chat", limite, VENTANA_MS)) {
            return error(
                "Estás enviando muchos mensajes seguidos. Espera unos minutos e inténtalo de nuevo.",
                429
            );
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

        // Historial que manda el navegador: se valida todo.
        const crudo = Array.isArray(cuerpo.historial) ? cuerpo.historial.slice(-MAX_MENSAJES_HISTORIAL) : [];
        const historial = [];
        let totalCaracteres = 0;

        for (const m of crudo) {
            if (!m || (m.rol !== "user" && m.rol !== "model") || typeof m.contenido !== "string") continue;

            const contenido = m.contenido.slice(0, 20000);
            if (!contenido.trim()) continue;

            totalCaracteres += contenido.length;
            historial.push({ rol: m.rol, contenido });
        }

        if (totalCaracteres > MAX_CARACTERES_HISTORIAL) {
            return error("La conversación es demasiado larga. Empieza una nueva.");
        }

        if (!regenerar) {
            historial.push({ rol: "user", contenido: mensaje || "(archivos adjuntos)" });
        }

        const contents = armarContenidos(historial);

        if (contents.length === 0 || contents[contents.length - 1].role !== "user") {
            return error("No hay un mensaje al que responder.");
        }

        if (!regenerar && adjuntosOk.lista.length) {
            sumarAdjuntos(contents, adjuntosOk.lista);
        }

        const ajustes = {
            estilo: ESTILOS.includes(cuerpo.ajustes && cuerpo.ajustes.estilo)
                ? cuerpo.ajustes.estilo
                : "equilibrado",
            buscarWeb: !(cuerpo.ajustes && cuerpo.ajustes.buscarWeb === false)
        };

        const instruccion = promptChat({ usuario: {}, ajustes, ahora: new Date() });

        const flujo = abrirStream();

        const trabajo = (async () => {
            try {
                const resultado = await transmitir({
                    env,
                    contents,
                    instruccion,
                    buscarWeb: ajustes.buscarWeb,
                    enviar: flujo.enviar
                });

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
        console.error("Error en el chat sin cuentas:", e);
        return json({ error: "No se pudo procesar el mensaje: " + e.message }, 500);
    }
}
