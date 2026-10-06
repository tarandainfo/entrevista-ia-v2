import { error, exigirUsuario, leerAjustes } from "../_lib/util.js";

export async function onRequestGet(context) {

    try {
        const { usuario, respuesta } = await exigirUsuario(context, { perfil: false });
        if (respuesta) return respuesta;

        const { results: conversaciones } = await context.env.DB
            .prepare("SELECT id, titulo, creada, actualizada FROM conversaciones WHERE usuario_id = ? ORDER BY creada ASC")
            .bind(usuario.id)
            .all();

        const salida = [];

        for (const conversacion of conversaciones || []) {
            const { results: mensajes } = await context.env.DB
                .prepare("SELECT rol, contenido, fuentes, origen, creado FROM mensajes WHERE conversacion_id = ? ORDER BY id ASC")
                .bind(conversacion.id)
                .all();

            salida.push({ ...conversacion, mensajes: mensajes || [] });
        }

        const paquete = {
            exportado: new Date().toISOString(),
            perfil: {
                email: usuario.email,
                nombre: usuario.nombre,
                apellido: usuario.apellido,
                genero: usuario.genero,
                ajustes: leerAjustes(usuario.ajustes)
            },
            conversaciones: salida
        };

        return new Response(JSON.stringify(paquete, null, 2), {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Content-Disposition": 'attachment; filename="mis-datos-leda.json"',
                "Cache-Control": "no-store"
            }
        });

    } catch (e) {
        console.error("Error exportando datos:", e);
        return error("No se pudieron exportar los datos: " + e.message, 500);
    }
}
