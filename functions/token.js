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
