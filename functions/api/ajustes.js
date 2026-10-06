import {
    json,
    error,
    exigirUsuario,
    leerAjustes,
    usuarioPublico
} from "../_lib/util.js";

const TEMAS = ["claro", "oscuro", "auto"];
const ESTILOS = ["conciso", "equilibrado", "detallado"];

export async function onRequestPatch(context) {

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

        const ajustes = leerAjustes(usuario.ajustes);

        if (cuerpo.tema !== undefined) {
            if (!TEMAS.includes(cuerpo.tema)) return error("Tema inválido.");
            ajustes.tema = cuerpo.tema;
        }

        if (cuerpo.estilo !== undefined) {
            if (!ESTILOS.includes(cuerpo.estilo)) return error("Estilo inválido.");
            ajustes.estilo = cuerpo.estilo;
        }

        if (cuerpo.buscarWeb !== undefined) {
            if (typeof cuerpo.buscarWeb !== "boolean") return error("Valor inválido.");
            ajustes.buscarWeb = cuerpo.buscarWeb;
        }

        await context.env.DB
            .prepare("UPDATE usuarios SET ajustes = ? WHERE id = ?")
            .bind(JSON.stringify(ajustes), usuario.id)
            .run();

        const fila = await context.env.DB
            .prepare("SELECT * FROM usuarios WHERE id = ?")
            .bind(usuario.id)
            .first();

        return json({ usuario: usuarioPublico(fila) });

    } catch (e) {
        console.error("Error en /api/ajustes:", e);
        return error("No se pudieron guardar los ajustes: " + e.message, 500);
    }
}
