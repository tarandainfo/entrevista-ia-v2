// ========================================
// ORQUESTADOR DE MODELOS
// ========================================
//
// Prueba los proveedores en orden y se queda con el primero que responda.
// Si el principal (Gemini) se quedó sin cupo, pasa al siguiente.

import { transmitirGemini } from "./gemini.js";
import { listaProveedores, transmitirOpenAI, transmitirClaude, transmitirWorkers } from "./proveedores.js";

export function hayModelosConfigurados(env) {
    return listaProveedores(env).length > 0;
}

// instruccionPara(proveedor) devuelve el prompt adecuado: los proveedores
// alternativos no tienen búsqueda web y el prompt tiene que decirlo.
export async function transmitir({ env, contents, instruccionPara, buscarWeb, enviar }) {
    const proveedores = listaProveedores(env);
    const fallidos = [];

    for (const proveedor of proveedores) {
        const instruccion = instruccionPara(proveedor);
        let resultado;

        if (proveedor === "gemini") {
            resultado = await transmitirGemini({ env, contents, instruccion, buscarWeb, enviar });
        } else if (proveedor === "openai") {
            resultado = await transmitirOpenAI({ env, contents, instruccion, enviar });
        } else if (proveedor === "claude") {
            resultado = await transmitirClaude({ env, contents, instruccion, enviar });
        } else {
            resultado = await transmitirWorkers({ env, contents, instruccion, enviar });
        }

        // Respondió (o el cliente se fue, o fue un caso que otro proveedor no arregla).
        if (!resultado.conexionFallida) {
            return { ...resultado, proveedor };
        }

        fallidos.push({ proveedor, resultado });
    }

    if (fallidos.length === 0) {
        return {
            texto: "",
            fuentes: [],
            clienteSeFue: false,
            error: "No hay ningún modelo configurado: falta GEMINI_API_KEY (o un proveedor alternativo)."
        };
    }

    // Todos fallaron: se muestra el motivo del primero y se listan los demás.
    const primero = fallidos[0].resultado;
    const otros = fallidos.slice(1).map((f) => f.resultado.resumen || f.proveedor);

    return {
        texto: "",
        fuentes: [],
        clienteSeFue: false,
        error: otros.length
            ? `${primero.error} También se intentó con otros proveedores sin éxito: ${otros.join(", ")}.`
            : primero.error
    };
}
