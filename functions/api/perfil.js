import {
    json,
    error,
    exigirUsuario,
    usuarioPublico,
    limpiarTexto
} from "../_lib/util.js";

const GENEROS = ["hombre", "mujer", "nodecir"];

export async function onRequestPut(context) {

    try {
        const { usuario, respuesta } = await exigirUsuario(context, {
            mutante: true,
            perfil: false
        });
        if (respuesta) return respuesta;

        let cuerpo;
        try {
            cuerpo = await context.request.json();
        } catch (e) {
            return error("Pedido inválido.");
        }

        const nombre = limpiarTexto(cuerpo.nombre, 40);
        const apellido = limpiarTexto(cuerpo.apellido, 40);
        const genero = String(cuerpo.genero || "");

        if (!nombre || !apellido) {
            return error("Escribe tu nombre y tu apellido.");
        }

        if (!GENEROS.includes(genero)) {
            return error("Elige una opción de género.");
        }

        await context.env.DB
            .prepare("UPDATE usuarios SET nombre = ?, apellido = ?, genero = ? WHERE id = ?")
            .bind(nombre, apellido, genero, usuario.id)
            .run();

        const fila = await context.env.DB
            .prepare("SELECT * FROM usuarios WHERE id = ?")
            .bind(usuario.id)
            .first();

        return json({ usuario: usuarioPublico(fila) });

    } catch (e) {
        console.error("Error en /api/perfil:", e);
        return error("No se pudo guardar el perfil: " + e.message, 500);
    }
}
