import { ahoraMs, limpiarTexto } from "./util.js";

export function tituloDesde(texto, respaldo = "Conversación nueva") {
    const titulo = limpiarTexto(texto, 60);
    return titulo || respaldo;
}

// Devuelve la conversación del usuario con ese id, o null si no existe
// o no es suya.
export function buscarConversacion(env, id, usuarioId) {
    return env.DB
        .prepare("SELECT id, titulo, creada, actualizada FROM conversaciones WHERE id = ? AND usuario_id = ?")
        .bind(id, usuarioId)
        .first();
}

export async function crearConversacion(env, usuarioId, titulo) {
    const id = crypto.randomUUID();
    const ahora = ahoraMs();

    await env.DB
        .prepare("INSERT INTO conversaciones (id, usuario_id, titulo, creada, actualizada) VALUES (?, ?, ?, ?, ?)")
        .bind(id, usuarioId, titulo, ahora, ahora)
        .run();

    return { id, titulo, creada: ahora, actualizada: ahora };
}

export function insertarMensaje(env, { conversacionId, rol, contenido, fuentes = null, origen = "texto" }) {
    return env.DB
        .prepare(
            "INSERT INTO mensajes (conversacion_id, rol, contenido, fuentes, origen, creado) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(
            conversacionId,
            rol,
            contenido,
            fuentes && fuentes.length ? JSON.stringify(fuentes) : null,
            origen,
            ahoraMs()
        );
}

export function tocarConversacion(env, id) {
    return env.DB
        .prepare("UPDATE conversaciones SET actualizada = ? WHERE id = ?")
        .bind(ahoraMs(), id);
}
