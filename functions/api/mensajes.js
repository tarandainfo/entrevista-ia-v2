import { json, error, exigirUsuario } from "../_lib/util.js";
import {
    buscarConversacion,
    crearConversacion,
    insertarMensaje,
    tocarConversacion,
    tituloDesde
} from "../_lib/conversaciones.js";

// Guarda mensajes sueltos en el historial. Lo usa el modo voz:
// cada turno hablado se transcribe y se guarda como texto.

export async function onRequestPost(context) {

    try {
        const { usuario, respuesta } = await exigirUsuario(context, { mutante: true });
        if (respuesta) return respuesta;

        let cuerpo;
        try {
            cuerpo = await context.request.json();
        } catch (e) {
            return error("Pedido inválido.");
        }

        const items = Array.isArray(cuerpo.mensajes) ? cuerpo.mensajes.slice(0, 20) : [];

        const validos = items
            .filter((m) => m && (m.rol === "user" || m.rol === "model") && typeof m.contenido === "string")
            .map((m) => ({ rol: m.rol, contenido: m.contenido.trim().slice(0, 20000) }))
            .filter((m) => m.contenido.length > 0);

        if (validos.length === 0) return error("No hay mensajes para guardar.");

        let conversacion = null;

        if (cuerpo.conversacionId) {
            conversacion = await buscarConversacion(context.env, String(cuerpo.conversacionId), usuario.id);
            if (!conversacion) return error("No encontré esa conversación.", 404);
        } else {
            const primerUsuario = validos.find((m) => m.rol === "user");
            conversacion = await crearConversacion(
                context.env,
                usuario.id,
                tituloDesde(primerUsuario ? primerUsuario.contenido : "", "Conversación por voz")
            );
        }

        const sentencias = validos.map((m) =>
            insertarMensaje(context.env, {
                conversacionId: conversacion.id,
                rol: m.rol,
                contenido: m.contenido,
                origen: "voz"
            })
        );
        sentencias.push(tocarConversacion(context.env, conversacion.id));

        await context.env.DB.batch(sentencias);

        return json({ conversacionId: conversacion.id, titulo: conversacion.titulo });

    } catch (e) {
        console.error("Error guardando mensajes:", e);
        return error("No se pudo guardar la conversación: " + e.message, 500);
    }
}
