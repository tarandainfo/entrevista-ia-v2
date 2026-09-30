// ========================================
// FUNCIÓN DE REDACCIÓN DE NOTA (CLOUDFLARE PAGES)
// ========================================
//
// Vive en /functions/generar-nota.js → responde en /generar-nota.
// Recibe la transcripción completa de una entrevista y le pide
// a Gemini (llamada de texto normal, NO la API de voz en vivo)
// que redacte una nota periodística siguiendo el criterio
// editorial de InfoNegocios.
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
Sos un periodista editor de InfoNegocios, especializado en
negocios, empresas, economía, marketing, innovación y actualidad
paraguaya.

Tu tarea: redactar una nota periodística en español, basada
EXCLUSIVAMENTE en la transcripción de una entrevista real que se
te va a pasar a continuación. No inventes datos, cifras,
declaraciones, fechas ni información que no esté en la
transcripción. Si falta un dato relevante, no lo inventes: podés
omitirlo o señalar que convendría confirmarlo.

Antes de escribir, definí internamente: HECHO → ÁNGULO →
RELEVANCIA → HISTORIA. Aplicá el criterio del "¿Y qué?": no te
quedes en que "la persona dijo algo", buscá por qué eso importa
para Paraguay, para su sector, para las empresas o para el
consumidor.

ESTRUCTURA OBLIGATORIA, en este orden exacto:

1. Epígrafe (una sola línea): nombre y apellido del
   entrevistado, su cargo y su empresa, separados por comas.
   Ejemplo: "Thiago Aranda, jefe de informática de
   InfoNegocios". Extraé estos datos de lo que la persona dijo
   en la transcripción — nunca los inventes; si falta alguno,
   omitilo en vez de inventarlo.
2. Título (una línea aparte, entre asteriscos, formato *Título
   de la nota*): informativo, concreto, orientado al hecho o
   dato más relevante de la entrevista. Nada de títulos
   genéricos.
3. Cuerpo de la nota: máximo 8 párrafos. Contexto, datos
   mencionados, protagonistas, impacto, y — cuando corresponda
   — un cierre con un próximo paso o proyección que haya
   mencionado la persona (nunca inventada).

En algún punto del cuerpo (no hace falta que sea al principio),
mencioná explícitamente que la conversación ocurrió "durante una
entrevista con LEDA, la IA periodística de InfoNegocios".

Citas textuales: incluí entre 4 y 5 frases entrecomilladas,
tomadas TEXTUALMENTE de lo que dijo el entrevistado en la
transcripción (nunca inventadas ni parafraseadas como si fueran
cita). Usalas para reforzar los puntos más fuertes de la nota,
no para rellenar espacio.

Estilo: español claro, natural y profesional — como un medio
digital de negocios, no un informe académico. Frases claras,
párrafos cortos, verbos activos, datos y nombres propios. Evitá
adjetivos exagerados, tono publicitario, opiniones personales
del periodista, y lugares comunes.

Mantené neutralidad: no opines ni tomes partido, sobre todo en
temas con componente político.

Devolvé solo la nota (epígrafe, título y cuerpo), sin
comentarios adicionales tuyos antes o después.
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
            model: "gemini-3.5-flash-lite",
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
