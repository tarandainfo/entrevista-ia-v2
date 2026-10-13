// ========================================
// PROVEEDORES ALTERNATIVOS DE MODELOS
// ========================================
//
// Gemini es el principal, pero si no tiene cupo (o no está configurado)
// LEDA puede responder con:
//   - "openai":  cualquier servicio con API compatible con OpenAI
//                (Groq, OpenRouter, Mistral, Cerebras, etc.).
//                Variables: PROVEEDOR_URL, PROVEEDOR_KEY, PROVEEDOR_MODELO.
//   - "claude":  API de Claude (Anthropic), de pago por uso. Lee imágenes y PDF.
//                Variables: ANTHROPIC_API_KEY y, opcional, ANTHROPIC_MODELO.
//   - "workers": Workers AI de Cloudflare (gratis dentro de un cupo diario).
//                Requiere conectar el servicio de IA con el nombre AI.
//                Variable opcional: WORKERS_AI_MODELO.
//
// Estos proveedores NO tienen la búsqueda web de Google: responden con lo
// que saben y no dan links verificados.

import { leerEventos, datosDelBloque } from "./gemini.js";

const MODELO_WORKERS_POR_DEFECTO = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MODELO_CLAUDE_POR_DEFECTO = "claude-haiku-4-5-20251001";

// Orden de prueba (por defecto: Gemini, luego los alternativos que haya).
export function listaProveedores(env) {
    const orden = String(env.PROVEEDORES || "gemini,claude,openai,workers")
        .split(",")
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean);

    const configurados = {
        gemini: Boolean(env.GEMINI_API_KEY),
        claude: Boolean(env.ANTHROPIC_API_KEY),
        openai: Boolean(env.PROVEEDOR_URL && env.PROVEEDOR_KEY && env.PROVEEDOR_MODELO),
        workers: Boolean(env.AI && typeof env.AI.run === "function")
    };

    return Array.from(new Set(orden)).filter((p) => configurados[p]);
}

// Convierte el historial al formato de mensajes tipo OpenAI.
export function aMensajes(contents, instruccion, { vision = false } = {}) {
    const mensajes = [{ role: "system", content: instruccion }];

    for (const c of contents) {
        const rol = c.role === "model" ? "assistant" : "user";
        const textos = [];
        const imagenes = [];

        for (const parte of c.parts) {
            if (typeof parte.text === "string") {
                textos.push(parte.text);
            } else if (parte.inlineData) {
                const { mimeType, data } = parte.inlineData;
                if (vision && /^image\//.test(mimeType)) {
                    imagenes.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${data}` } });
                } else {
                    textos.push("[Se adjuntó un archivo (imagen o PDF) que este modelo no puede leer.]");
                }
            }
        }

        const texto = textos.join("\n\n");

        mensajes.push({
            role: rol,
            content: imagenes.length ? [{ type: "text", text: texto }, ...imagenes] : texto
        });
    }

    return mensajes;
}

// Resultado de una conexión que no funcionó.
function conexionFallida(proveedor, status, motivo) {
    return {
        texto: "",
        fuentes: [],
        clienteSeFue: false,
        conexionFallida: true,
        resumen: `${proveedor} (${status || "sin conexión"})`,
        error: `${proveedor}: ${status || "sin conexión"} ${motivo}`.trim()
    };
}

function limpiarMotivo(texto) {
    return String(texto || "").replace(/\s+/g, " ").trim().slice(0, 300) || "sin detalle";
}

// Lee un stream de texto (formato OpenAI o de Workers AI) y lo transmite.
async function consumir(cuerpo, enviar) {
    let texto = "";
    let clienteSeFue = false;

    for await (const bloque of leerEventos(cuerpo)) {
        for (const linea of bloque.split(/\r?\n/)) {
            if (!linea.startsWith("data:")) continue;

            const contenido = linea.slice(5).trim();
            if (!contenido || contenido === "[DONE]") continue;

            let datos;
            try { datos = JSON.parse(contenido); } catch (e) { continue; }

            // Formato OpenAI: choices[0].delta.content. Workers AI: response.
            let delta = "";
            if (datos.choices && datos.choices[0] && datos.choices[0].delta) {
                delta = datos.choices[0].delta.content || "";
            } else if (typeof datos.response === "string") {
                delta = datos.response;
            }

            if (!delta) continue;
            texto += delta;

            try {
                await enviar({ t: "delta", texto: delta });
            } catch (e) {
                clienteSeFue = true;
                break;
            }
        }

        if (clienteSeFue) break;
    }

    return { texto, clienteSeFue };
}

function resultadoFinal(texto, clienteSeFue) {
    return {
        texto,
        fuentes: [],
        clienteSeFue,
        error: texto.trim() ? null : "No recibí una respuesta del modelo. Intenta de nuevo."
    };
}

// ---------- Compatible con OpenAI ----------

export async function transmitirOpenAI({ env, contents, instruccion, enviar }) {
    const base = String(env.PROVEEDOR_URL).replace(/\/+$/, "");

    let respuesta;
    try {
        respuesta = await fetch(`${base}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${env.PROVEEDOR_KEY}`
            },
            body: JSON.stringify({
                model: env.PROVEEDOR_MODELO,
                messages: aMensajes(contents, instruccion, { vision: env.PROVEEDOR_VISION === "si" }),
                stream: true,
                max_tokens: 4096
            })
        });
    } catch (e) {
        return conexionFallida("Proveedor alternativo", 0, "no se pudo conectar");
    }

    if (!respuesta.ok || !respuesta.body) {
        const motivo = limpiarMotivo(await respuesta.text().catch(() => ""));
        console.error("Proveedor alternativo respondió con error:", respuesta.status, motivo);
        return conexionFallida(`Proveedor alternativo (${env.PROVEEDOR_MODELO})`, respuesta.status, motivo);
    }

    const { texto, clienteSeFue } = await consumir(respuesta.body, enviar);
    return resultadoFinal(texto, clienteSeFue);
}

// ---------- Claude (Anthropic, API nativa de mensajes) ----------

// Convierte el historial al formato de Claude. A diferencia de los otros
// proveedores, Claude lee imágenes y PDF directamente.
export function aMensajesClaude(contents) {
    return contents.map((c) => {
        const bloques = [];

        for (const parte of c.parts) {
            if (typeof parte.text === "string") {
                if (parte.text) bloques.push({ type: "text", text: parte.text });
            } else if (parte.inlineData) {
                const { mimeType, data } = parte.inlineData;

                if (/^image\//.test(mimeType)) {
                    bloques.push({ type: "image", source: { type: "base64", media_type: mimeType, data } });
                } else if (mimeType === "application/pdf") {
                    bloques.push({ type: "document", source: { type: "base64", media_type: mimeType, data } });
                }
            }
        }

        return {
            role: c.role === "model" ? "assistant" : "user",
            content: bloques.length ? bloques : [{ type: "text", text: "(sin texto)" }]
        };
    });
}

// Lee el stream de Claude: los textos llegan en eventos content_block_delta.
async function consumirClaude(cuerpo, enviar) {
    let texto = "";
    let clienteSeFue = false;
    let errorDelStream = null;

    for await (const bloque of leerEventos(cuerpo)) {
        for (const linea of bloque.split(/\r?\n/)) {
            if (!linea.startsWith("data:")) continue;

            let datos;
            try { datos = JSON.parse(linea.slice(5).trim()); } catch (e) { continue; }

            if (datos.type === "error") {
                errorDelStream = (datos.error && datos.error.message) || "error del servicio";
                continue;
            }

            if (datos.type !== "content_block_delta") continue;
            if (!datos.delta || datos.delta.type !== "text_delta" || !datos.delta.text) continue;

            texto += datos.delta.text;

            try {
                await enviar({ t: "delta", texto: datos.delta.text });
            } catch (e) {
                clienteSeFue = true;
                break;
            }
        }

        if (clienteSeFue) break;
    }

    return { texto, clienteSeFue, errorDelStream };
}

export async function transmitirClaude({ env, contents, instruccion, enviar }) {
    const modelo = env.ANTHROPIC_MODELO || MODELO_CLAUDE_POR_DEFECTO;
    const base = String(env.ANTHROPIC_API_BASE || "https://api.anthropic.com").replace(/\/+$/, "");

    let respuesta;
    try {
        respuesta = await fetch(`${base}/v1/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": env.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
                model: modelo,
                max_tokens: 4096,
                system: instruccion,
                messages: aMensajesClaude(contents),
                stream: true
            })
        });
    } catch (e) {
        return conexionFallida(`Claude (${modelo})`, 0, "no se pudo conectar");
    }

    if (!respuesta.ok || !respuesta.body) {
        let motivo = "";
        try {
            const datos = JSON.parse(await respuesta.text());
            motivo = datos && datos.error && datos.error.message ? datos.error.message : "";
        } catch (e) { /* sin detalle */ }

        motivo = limpiarMotivo(motivo);
        console.error("Claude respondió con error:", respuesta.status, motivo);
        return conexionFallida(`Claude (${modelo})`, respuesta.status, motivo);
    }

    const { texto, clienteSeFue, errorDelStream } = await consumirClaude(respuesta.body, enviar);

    if (!texto.trim() && errorDelStream) {
        return conexionFallida(`Claude (${modelo})`, 0, limpiarMotivo(errorDelStream));
    }

    return resultadoFinal(texto, clienteSeFue);
}

// ---------- Workers AI (Cloudflare) ----------

export async function transmitirWorkers({ env, contents, instruccion, enviar }) {
    const modelo = env.WORKERS_AI_MODELO || MODELO_WORKERS_POR_DEFECTO;

    let salida;
    try {
        salida = await env.AI.run(modelo, {
            messages: aMensajes(contents, instruccion),
            stream: true,
            max_tokens: 2048
        });
    } catch (e) {
        console.error("Workers AI falló:", e);
        return conexionFallida(`Workers AI (${modelo})`, 0, limpiarMotivo(e && e.message));
    }

    if (!salida || typeof salida.getReader !== "function") {
        return conexionFallida(`Workers AI (${modelo})`, 0, "respuesta inesperada");
    }

    const { texto, clienteSeFue } = await consumir(salida, enviar);
    return resultadoFinal(texto, clienteSeFue);
}

// ---------- Prueba corta para el diagnóstico ----------

export async function probarProveedores(env) {
    const salida = [];
    const contents = [{ role: "user", parts: [{ text: "Responde solo con la palabra: ok" }] }];
    const instruccion = "Responde de forma muy breve.";

    for (const p of listaProveedores(env)) {
        if (p === "gemini") continue; // Gemini se prueba aparte, modelo por modelo.

        const fn = p === "openai" ? transmitirOpenAI : p === "claude" ? transmitirClaude : transmitirWorkers;

        try {
            const r = await fn({ env, contents, instruccion, enviar: async () => {} });
            salida.push({
                proveedor: p,
                ok: Boolean(r.texto.trim()),
                motivo: r.texto.trim() ? undefined : r.error
            });
        } catch (e) {
            salida.push({ proveedor: p, ok: false, motivo: limpiarMotivo(e.message) });
        }
    }

    return salida;
}
