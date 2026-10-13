import { json } from "../_lib/util.js";
import { probarConexion, permitir } from "../_lib/gemini.js";
import { listaProveedores, probarProveedores } from "../_lib/proveedores.js";

// Página de diagnóstico: abrirla en el navegador (/api/diagnostico) muestra
// qué proveedores de modelos están configurados y qué responde cada uno.
// No devuelve claves ni ningún dato privado.
export async function onRequestGet(context) {
    const { request, env } = context;

    if (!permitir(request, "diagnostico", 6, 10 * 60 * 1000)) {
        return json({ error: "Demasiadas pruebas seguidas. Espera unos minutos." }, 429);
    }

    const proveedores = listaProveedores(env);

    const respuesta = {
        proveedoresEnOrden: proveedores,
        claveGeminiCargada: Boolean(env.GEMINI_API_KEY),
        modoCuentas: env.MODO_CUENTAS === "si",
        modeloConfigurado: env.GEMINI_CHAT_MODEL || "(ninguno: se usa el habitual)",
        gemini: [],
        alternativos: []
    };

    const avisos = [];

    if (proveedores.length === 0) {
        respuesta.aviso = "No hay ningún modelo configurado. Falta GEMINI_API_KEY en Cloudflare Pages (Settings → Environment variables) o un proveedor alternativo: ANTHROPIC_API_KEY (Claude), PROVEEDOR_URL + PROVEEDOR_KEY + PROVEEDOR_MODELO (compatible con OpenAI) o el servicio Workers AI con el nombre AI. Después hay que volver a desplegar.";
        return json(respuesta, 200);
    }

    if (proveedores.includes("gemini")) {
        respuesta.gemini = await probarConexion(env);
        const funciona = respuesta.gemini.find((p) => p.sinBusqueda.ok);

        if (!funciona) {
            avisos.push("Gemini no respondió con ningún modelo (mira el 'motivo' de cada prueba).");
        } else if (!funciona.conBusqueda.ok) {
            avisos.push(`Gemini funciona con ${funciona.modelo}, pero sin búsqueda web.`);
        } else {
            avisos.push(`Gemini funciona: ${funciona.modelo} responde y acepta búsqueda web.`);
        }
    }

    respuesta.alternativos = await probarProveedores(env);

    for (const alt of respuesta.alternativos) {
        avisos.push(alt.ok
            ? `El proveedor alternativo "${alt.proveedor}" funciona (sin búsqueda web).`
            : `El proveedor alternativo "${alt.proveedor}" NO responde: ${alt.motivo}`);
    }

    const algunoFunciona =
        respuesta.gemini.some((p) => p.sinBusqueda.ok) || respuesta.alternativos.some((a) => a.ok);

    respuesta.aviso = (algunoFunciona ? "" : "Ningún modelo respondió. ") + avisos.join(" ");

    return json(respuesta, 200);
}
