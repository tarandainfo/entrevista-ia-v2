import { json, error, exigirUsuario } from "../_lib/util.js";
import { extraerArchivos } from "../_lib/archivos.js";

// Los archivos no se guardan aparte: viven como bloques dentro de
// los mensajes de LEDA. Acá solo los buscamos y los listamos.

export async function onRequestGet(context) {

    try {
        const { usuario, respuesta } = await exigirUsuario(context);
        if (respuesta) return respuesta;

        const { results } = await context.env.DB
            .prepare(
                `SELECT m.id AS mensajeId, m.contenido, m.creado,
                        c.id AS conversacionId, c.titulo
                 FROM mensajes m
                 JOIN conversaciones c ON c.id = m.conversacion_id
                 WHERE c.usuario_id = ?
                   AND m.rol = 'model'
                   AND m.contenido LIKE '%leda-archivo%'
                 ORDER BY m.id DESC
                 LIMIT 60`
            )
            .bind(usuario.id)
            .all();

        const archivos = [];

        for (const fila of results || []) {
            for (const spec of extraerArchivos(fila.contenido)) {
                archivos.push({
                    conversacionId: fila.conversacionId,
                    conversacionTitulo: fila.titulo,
                    mensajeId: fila.mensajeId,
                    creado: fila.creado,
                    spec
                });
            }
        }

        return json({ archivos: archivos.slice(0, 60) });

    } catch (e) {
        console.error("Error listando archivos:", e);
        return error("No se pudieron cargar los archivos: " + e.message, 500);
    }
}
