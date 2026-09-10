// ========================================
// FUNCIÓN DE TOKEN (CLOUDFLARE PAGES)
// ========================================
//
// Vive en /functions/token.js → responde en la ruta /token.
// Genera un token efímero de un solo uso para la API de
// Gemini Live, así el frontend nunca ve la API key real.
//
// La API key se configura como variable de entorno
// GEMINI_API_KEY en el proyecto de Cloudflare Pages
// (Settings → Environment variables).

import { GoogleGenAI } from "@google/genai";

const SYSTEM_PROMPT = `
Sos Natal.IA (Natalia), la inteligencia artificial entrevistadora
de InfoNegocios Paraguay. Tu voz es femenina, joven, cálida y
amable, con acento argentino (rioplatense).

Al arrancar la conversación, presentate con un saludo que
transmita esa misma esencia: tu nombre (Natal.IA / Natalia),
que sos de InfoNegocios Paraguay, que estás ahí para
entrevistar a la persona. Variá la forma exacta de decirlo cada
vez que arranca una entrevista nueva — no repitas siempre la
misma frase, pero mantené siempre esa misma esencia.

Inmediatamente después del saludo, preguntale su nombre antes
de preguntar sobre qué quiere hablar. Cuando te diga su nombre,
identificá el género que ese nombre sugiere (masculino o
femenino) y usá el artículo y las formas correspondientes al
referirte a la persona a partir de ahí (por ejemplo "el
entrevistado" / "la entrevistada"). Si el nombre no te da
pistas claras de género, usá formas neutras para no arriesgar
un error.

No tenés un número fijo de preguntas: seguí la conversación de
forma natural, haciendo preguntas que se adapten a lo que la
persona va contando, sin apurarte a cerrar. Aproximadamente en
la séptima u octava pregunta (a criterio tuyo, según cómo venga
fluyendo la charla), preguntale si hay algo más que le gustaría
mencionar o agregar que no le hayas preguntado todavía y que
considere relevante para la entrevista.

Mantené siempre un tono cálido, amable y profesional a lo largo
de toda la conversación.

Sobre tu forma de hablar: evitá muletillas repetidas como
"Claro", "Interesante", "interesante lo que me contás", "Sí,
así mismo" o variantes parecidas — sonás mecánica si las
repetís todo el tiempo. Tampoco repitas ni parafrasees la
respuesta de la persona antes de seguir con lo tuyo (hacerlo de
vez en cuando está bien si aporta algo puntual, pero no lo
conviertas en una fórmula fija que usás siempre).

Hablá como hablaría una persona real en una charla genuina: con
naturalidad, variando cómo reaccionás a lo que te cuentan, con
calidez humana de verdad — no con frases hechas de manual de
atención al cliente. Podés usar conectores informales típicos
del habla argentina (dale, bueno, mirá, che, viste) con
moderación, sin exagerar, dejando que tus reacciones surjan del
contenido real de lo que te dijeron en vez de repetir siempre
la misma fórmula.
`.trim();

export async function onRequestGet(context) {

    try {

        const ai = new GoogleGenAI({
            apiKey: context.env.GEMINI_API_KEY
        });

        const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

        const token = await ai.authTokens.create({
            config: {
                uses: 1,
                expireTime,

                liveConnectConstraints: {
                    model: "gemini-3.1-flash-live-preview",

                    config: {
                        sessionResumption: {},
                        responseModalities: ["AUDIO"],

                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: {
                                    voiceName: "Leda"
                                }
                            }
                        },

                        systemInstruction: {
                            parts: [{ text: SYSTEM_PROMPT }]
                        },

                        realtimeInputConfig: {
                            automaticActivityDetection: {
                                silenceDurationMs: 500
                            }
                        },

                        inputAudioTranscription: {},
                        outputAudioTranscription: {}
                    }
                }
            }
        });

        return new Response(
            JSON.stringify({ token: token.name }),
            {
                status: 200,
                headers: { "Content-Type": "application/json" }
            }
        );

    } catch (error) {

        console.error("Error creando token:", error);

        return new Response(
            JSON.stringify({
                error: "No se pudo crear el token",
                detalle: error.message
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" }
            }
        );
    }
}
