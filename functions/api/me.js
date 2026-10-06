import { json, usuarioActual, usuarioPublico } from "../_lib/util.js";

export async function onRequestGet(context) {

    try {
        const usuario = await usuarioActual(context);

        return json({
            usuario: usuario ? usuarioPublico(usuario) : null
        });

    } catch (e) {
        console.error("Error en /api/me:", e);
        return json({ usuario: null, error: e.message }, 500);
    }
}
