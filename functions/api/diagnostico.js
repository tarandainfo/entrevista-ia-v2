import { json } from "../_lib/util.js";
import { probarConexion, permitir } from "../_lib/gemini.js";

// Página de diagnóstico: abrirla en el navegador (/api/diagnostico) muestra
// si la clave de Gemini está cargada y qué responde Google para cada modelo.
// No devuelve la clave ni ningún dato privado.
export async function onRequestGet(context) {
    const { request, env } = context;

    if (!permitir(request, "diagnostico", 6, 10 * 60 * 1000)) {
        return json({ error: "Demasiadas pruebas seguidas. Espera unos minutos." }, 429);
    }

    const respuesta = {
        claveGeminiCargada: Boolean(env.GEMINI_API_KEY),
        modoCuentas: env.MODO_CUENTAS === "si",
        modeloConfigurado: env.GEMINI_CHAT_MODEL || "(ninguno: se usa el habitual)",
        pruebas: []
    };

    if (!env.GEMINI_API_KEY) {
        respuesta.aviso = "Falta la variable GEMINI_API_KEY en Cloudflare Pages (Settings → Environment variables). Después hay que volver a desplegar.";
        return json(respuesta, 200);
    }

    respuesta.pruebas = await probarConexion(env);

    const funciona = respuesta.pruebas.find((p) => p.sinBusqueda.ok);

    if (!funciona) {
        respuesta.aviso = "Ningún modelo respondió. Mira el 'motivo' de cada prueba: indica qué rechazó Google.";
    } else if (!funciona.conBusqueda.ok) {
        respuesta.aviso = `El modelo ${funciona.modelo} funciona, pero NO acepta la búsqueda web: LEDA responderá sin links ni fuentes.`;
    } else {
        respuesta.aviso = `Todo bien: ${funciona.modelo} responde y acepta búsqueda web.`;
    }

    return json(respuesta, 200);
}
