import { json, error, exigirUsuario } from "../../_lib/util.js";

export async function onRequestGet(context) {

    try {
        const { usuario, respuesta } = await exigirUsuario(context);
        if (respuesta) return respuesta;

        const { results } = await context.env.DB
            .prepare(
                `SELECT id, titulo, creada, actualizada
                 FROM conversaciones
                 WHERE usuario_id = ?
                 ORDER BY actualizada DESC
                 LIMIT 300`
            )
            .bind(usuario.id)
            .all();

        return json({ conversaciones: results || [] });

    } catch (e) {
        console.error("Error listando conversaciones:", e);
        return error("No se pudo cargar el historial: " + e.message, 500);
    }
}
