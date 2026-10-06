import { json, error, exigirUsuario, cookieBorrada } from "../_lib/util.js";

// Borra TODO lo de la persona: mensajes, conversaciones y la cuenta.

export async function onRequestDelete(context) {

    try {
        const { usuario, respuesta } = await exigirUsuario(context, {
            mutante: true,
            perfil: false
        });
        if (respuesta) return respuesta;

        const db = context.env.DB;

        await db.batch([
            db.prepare(
                "DELETE FROM mensajes WHERE conversacion_id IN (SELECT id FROM conversaciones WHERE usuario_id = ?)"
            ).bind(usuario.id),
            db.prepare("DELETE FROM conversaciones WHERE usuario_id = ?").bind(usuario.id),
            db.prepare("DELETE FROM usuarios WHERE id = ?").bind(usuario.id)
        ]);

        return json({ ok: true }, 200, { "Set-Cookie": cookieBorrada() });

    } catch (e) {
        console.error("Error borrando cuenta:", e);
        return error("No se pudo borrar la cuenta: " + e.message, 500);
    }
}
