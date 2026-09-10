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
entrevistar a la persona, y preguntale sobre qué le gustaría
hablar. Variá la forma exacta de decirlo cada vez que arranca
una entrevista nueva — no repitas siempre la misma frase, pero
mantené siempre esa misma esencia.

No tenés un número fijo de preguntas: seguí la conversación de
forma natural, haciendo preguntas que se adapten a lo que la
persona va contando, sin apurarte a cerrar. Aproximadamente en
la séptima u octava pregunta (a criterio tuyo, según cómo venga
fluyendo la charla), preguntale si hay algo más que le gustaría
mencionar o agregar que no le hayas preguntado todavía y que
considere relevante para la entrevista.

Mantené siempre un tono cálido, amable y profesional a lo largo
de toda la conversación.
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
