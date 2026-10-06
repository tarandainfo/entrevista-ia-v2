import {
    json,
    error,
    exigirUsuario,
    limpiarTexto,
    ahoraMs
} from "../../_lib/util.js";

async function conversacionDelUsuario(env, id, usuarioId) {
    return env.DB
        .prepare("SELECT id, titulo, creada, actualizada FROM conversaciones WHERE id = ? AND usuario_id = ?")
        .bind(id, usuarioId)
        .first();
}

export async function onRequestGet(context) {

    try {
        const { usuario, respuesta } = await exigirUsuario(context);
        if (respuesta) return respuesta;

        const id = context.params.id;
        const conversacion = await conversacionDelUsuario(context.env, id, usuario.id);

        if (!conversacion) return error("No encontré esa conversación.", 404);

        const { results } = await context.env.DB
            .prepare(
                `SELECT id, rol, contenido, fuentes, origen, creado
                 FROM mensajes
                 WHERE conversacion_id = ?
                 ORDER BY id ASC`
            )
            .bind(id)
            .all();

        const mensajes = (results || []).map((m) => {
            let fuentes = [];
            try { fuentes = m.fuentes ? JSON.parse(m.fuentes) : []; } catch (e) { fuentes = []; }
            return { ...m, fuentes };
        });

        return json({ conversacion, mensajes });

    } catch (e) {
        console.error("Error leyendo conversación:", e);
        return error("No se pudo abrir la conversación: " + e.message, 500);
    }
}

export async function onRequestPatch(context) {

    try {
        const { usuario, respuesta } = await exigirUsuario(context, { mutante: true });
        if (respuesta) return respuesta;

        const id = context.params.id;
        const conversacion = await conversacionDelUsuario(context.env, id, usuario.id);

        if (!conversacion) return error("No encontré esa conversación.", 404);

        let cuerpo;
        try {
            cuerpo = await context.request.json();
        } catch (e) {
            return error("Pedido inválido.");
        }

        const titulo = limpiarTexto(cuerpo.titulo, 80);
        if (!titulo) return error("El título no puede estar vacío.");

        await context.env.DB
            .prepare("UPDATE conversaciones SET titulo = ?, actualizada = ? WHERE id = ?")
            .bind(titulo, ahoraMs(), id)
            .run();

        return json({ ok: true, titulo });

    } catch (e) {
        console.error("Error renombrando conversación:", e);
        return error("No se pudo renombrar: " + e.message, 500);
    }
}

export async function onRequestDelete(context) {

    try {
        const { usuario, respuesta } = await exigirUsuario(context, { mutante: true });
        if (respuesta) return respuesta;

        const id = context.params.id;
        const conversacion = await conversacionDelUsuario(context.env, id, usuario.id);

        if (!conversacion) return error("No encontré esa conversación.", 404);

        await context.env.DB.batch([
            context.env.DB.prepare("DELETE FROM mensajes WHERE conversacion_id = ?").bind(id),
            context.env.DB.prepare("DELETE FROM conversaciones WHERE id = ?").bind(id)
        ]);

        return json({ ok: true });

    } catch (e) {
        console.error("Error borrando conversación:", e);
        return error("No se pudo borrar: " + e.message, 500);
    }
}
