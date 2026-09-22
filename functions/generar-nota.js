// ========================================
// FUNCIÓN DE REDACCIÓN DE NOTA (CLOUDFLARE PAGES)
// ========================================
//
// Vive en /functions/generar-nota.js → responde en /generar-nota.
// Recibe la transcripción completa de una entrevista y le pide
// a Gemini (llamada de texto normal, NO la API de voz en vivo)
// que redacte una nota periodística siguiendo el criterio
// editorial de InfoNegocios Paraguay.
//
// ⚠️ Aviso: no puedo probar esta función en vivo desde acá.
// Dos cosas puntuales pueden necesitar ajuste si falla:
// 1. El nombre del modelo ("gemini-2.5-flash") — si la cuenta
//    no tiene acceso a ese modelo, avisame el error exacto.
// 2. La forma de leer el texto de la respuesta (resultado.text)
//    — si el SDK devuelve la estructura distinto, también
//    avisame el error para ajustarlo.

import { GoogleGenAI } from "@google/genai";

const PROMPT_REDACCION = `
Sos un periodista editor de InfoNegocios Paraguay, especializado
en negocios, empresas, economía, marketing, innovación y
actualidad paraguaya.

Tu tarea: redactar una nota periodística de entre 500 y 800
palabras, en español, basada EXCLUSIVAMENTE en la transcripción
de una entrevista real que se te va a pasar a continuación. No
inventes datos, cifras, declaraciones, fechas ni información que
no esté en la transcripción. Si falta un dato relevante, no lo
inventes: podés omitirlo o señalar que convendría confirmarlo.

Antes de escribir, definí internamente: HECHO → ÁNGULO →
RELEVANCIA → HISTORIA. Aplicá el criterio del "¿Y qué?": no te
quedes en que "la persona dijo algo", buscá por qué eso importa
para Paraguay, para su sector, para las empresas o para el
consumidor.

Estructura de la nota:
- Título: informativo, concreto, orientado al hecho o dato más
  relevante de la entrevista. Nada de títulos genéricos.
- Bajada: una o dos líneas que expliquen qué pasó y por qué
  importa, sin repetir el título.
- Desarrollo: contexto, datos mencionados, declaraciones que
  aporten información real (no cites algo solo porque "suena
  lindo"), protagonistas, impacto.
- Cierre: cuando corresponda, un dato relevante, un próximo
  paso, o una proyección que haya mencionado la persona (nunca
  inventada).

Estilo: español claro, natural y profesional — como un medio
digital de negocios, no un informe académico. Frases claras,
párrafos cortos, verbos activos, datos y nombres propios. Evitá
adjetivos exagerados, tono publicitario, opiniones personales
del periodista, y lugares comunes.

Mantené neutralidad: no opines ni tomes partido, sobre todo en
temas con componente político.

Extensión total: entre 500 y 800 palabras (sin contar título ni
bajada). Devolvé solo la nota, sin comentarios adicionales tuyos
antes o después.
`.trim();


export async function onRequestPost(context) {

    try {

        const cuerpo = await context.request.json();
        const transcripcion = cuerpo.transcripcion;

        if (!transcripcion || transcripcion.trim().length < 20) {
            return new Response(
                JSON.stringify({ error: "La transcripción está vacía o es muy corta." }),
                { status: 400, headers: { "Content-Type": "application/json" } }
            );
        }

        const ai = new GoogleGenAI({
            apiKey: context.env.GEMINI_API_KEY
        });

        const resultado = await ai.models.generateContent({
            model: "gemini-3.6-flash",
            contents: [
                {
                    role: "user",
                    parts: [{
                        text: PROMPT_REDACCION +
                            "\n\nTRANSCRIPCIÓN DE LA ENTREVISTA:\n\n" +
                            transcripcion
                    }]
                }
            ]
        });

        const articulo = resultado.text;

        return new Response(
            JSON.stringify({ articulo }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );

    } catch (error) {

        console.error("Error generando la nota:", error);

        return new Response(
            JSON.stringify({
                error: "No se pudo generar la nota",
                detalle: error.message
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}
