import { GoogleGenAI } from "@google/genai";
import { json, error, exigirUsuario, origenValido } from "../_lib/util.js";
import { permitir } from "../_lib/gemini.js";
import { promptVoz } from "../_lib/prompts.js";

// Genera un token efímero (de un solo uso) para la API de voz en
// vivo de Gemini, así la API key real nunca llega al navegador.
// El prompt va "congelado" dentro del token, personalizado con
// el nombre de la persona.

export async function onRequestPost(context) {

    try {
        let usuario = {};

        if (context.env.MODO_CUENTAS === "si") {
            const sesion = await exigirUsuario(context, { mutante: true });
            if (sesion.respuesta) return sesion.respuesta;
            usuario = sesion.usuario;
        } else {
            // Sin cuentas: se pide el nombre en el navegador, no hay sesión.
            if (!origenValido(context.request)) return error("Origen no permitido.", 403);

            const limite = Number(context.env.LIMITE_VOZ_INVITADO) || 8;
            if (!permitir(context.request, "voz", limite, 10 * 60 * 1000)) {
                return error("Iniciaste muchas conversaciones por voz seguidas. Espera unos minutos.", 429);
            }
        }

        if (!context.env.GEMINI_API_KEY) {
            return error("Falta configurar GEMINI_API_KEY en el servidor.", 500);
        }

        const ai = new GoogleGenAI({ apiKey: context.env.GEMINI_API_KEY });

        const instruccion = promptVoz({ usuario, ahora: new Date() });

        const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

        const token = await ai.authTokens.create({
            config: {
                uses: 1,
                expireTime,

                liveConnectConstraints: {
                    model: "gemini-3.8-live",

                    config: {
                        sessionResumption: {},
                        responseModalities: ["AUDIO"],

                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: {
                                    voiceName: "Leda"
                                }
                            },
                            languageCode: "es-419"
                        },

                        systemInstruction: {
                            parts: [{ text: instruccion }]
                        },

                        realtimeInputConfig: {
                            automaticActivityDetection: {
                                startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
                                endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
                                prefixPaddingMs: 250,
                                silenceDurationMs: 200
                            }
                        },

                        inputAudioTranscription: {},
                        outputAudioTranscription: {}
                    }
                }
            }
        });

        // Se devuelve también el prompt: el navegador lo repite en su
        // configuración inicial, igual que hacía la versión anterior.
        return json({ token: token.name, instruccion });

    } catch (e) {
        console.error("Error creando token de voz:", e);
        return error("No se pudo iniciar la voz: " + e.message, 500);
    }
}
