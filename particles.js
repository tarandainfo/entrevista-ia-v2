// ========================================
// FONDO DE PARTÍCULAS (REACTIVO AL AUDIO)
// ========================================
//
// Red de partículas conectadas por líneas, en reposo la
// mayor parte del tiempo. Cuando LEDA está hablando (según
// el volumen real del audio que suena), aparecen más
// partículas y se mueven más rápido — la red se ve más
// viva. Al dejar de hablar, vuelve de a poco al reposo.
//
// Se expone como `window.FondoParticulas` para que
// script.js (script clásico, no un módulo) pueda usarlo.

(function () {

    const CANTIDAD_BASE = 55;
    const CANTIDAD_EXTRA = 60;
    const COLOR = "24, 180, 240"; // celeste eléctrico de la marca

    let canvas, ctx;
    let ancho = 0, alto = 0;

    let puntosBase = [];
    let puntosExtra = [];

    let analizador = null;
    let datosAudio = null;
    let nivelSuavizado = 0;

    let animando = false;


    function crearPunto(velocidad) {

        return {
            x: Math.random() * ancho,
            y: Math.random() * alto,
            vx: (Math.random() - 0.5) * velocidad,
            vy: (Math.random() - 0.5) * velocidad
        };
    }


    function iniciar(idCanvas) {

        canvas = document.getElementById(idCanvas);

        if (!canvas) {
            console.error("No se encontró el canvas:", idCanvas);
            return;
        }

        ctx = canvas.getContext("2d");

        ajustarTamano();
        window.addEventListener("resize", ajustarTamano);

        puntosBase = Array.from({ length: CANTIDAD_BASE }, () => crearPunto(0.3));
        puntosExtra = Array.from({ length: CANTIDAD_EXTRA }, () => crearPunto(0.9));

        if (!animando) {
            animando = true;
            requestAnimationFrame(bucleDeAnimacion);
        }
    }


    function ajustarTamano() {

        if (!canvas) {
            return;
        }

        ancho = canvas.width = canvas.clientWidth;
        alto = canvas.height = canvas.clientHeight;
    }


    function conectarAnalizador(nodoAnalizador) {

        analizador = nodoAnalizador;
        datosAudio = new Uint8Array(analizador.fftSize);
    }


    function calcularNivelAudio() {

        if (!analizador || !datosAudio) {
            return 0;
        }

        analizador.getByteTimeDomainData(datosAudio);

        let sumaCuadrados = 0;

        for (let i = 0; i < datosAudio.length; i++) {
            const valor = (datosAudio[i] - 128) / 128;
            sumaCuadrados += valor * valor;
        }

        const rms = Math.sqrt(sumaCuadrados / datosAudio.length);

        return Math.min(1, rms * 6);
    }


    function bucleDeAnimacion() {

        requestAnimationFrame(bucleDeAnimacion);

        if (!ctx || !ancho || !alto) {
            return;
        }

        ctx.clearRect(0, 0, ancho, alto);
        ctx.fillStyle = "#040910";
        ctx.fillRect(0, 0, ancho, alto);

        const nivelObjetivo = calcularNivelAudio();
        nivelSuavizado += (nivelObjetivo - nivelSuavizado) * 0.06;

        const cantidadExtraActiva = Math.round(puntosExtra.length * nivelSuavizado);
        const activos = puntosBase.concat(puntosExtra.slice(0, cantidadExtraActiva));

        const factorVelocidad = 1 + nivelSuavizado * 2;

        for (const p of activos) {

            p.x += p.vx * factorVelocidad;
            p.y += p.vy * factorVelocidad;

            if (p.x < 0 || p.x > ancho) p.vx *= -1;
            if (p.y < 0 || p.y > alto) p.vy *= -1;
        }

        const distanciaMaxima = 100 + nivelSuavizado * 60;

        for (let i = 0; i < activos.length; i++) {
            for (let j = i + 1; j < activos.length; j++) {

                const dx = activos[i].x - activos[j].x;
                const dy = activos[i].y - activos[j].y;
                const distancia = Math.sqrt(dx * dx + dy * dy);

                if (distancia < distanciaMaxima) {

                    const opacidad = (0.12 + nivelSuavizado * 0.15) * (1 - distancia / distanciaMaxima);

                    ctx.strokeStyle = "rgba(" + COLOR + ", " + opacidad + ")";
                    ctx.beginPath();
                    ctx.moveTo(activos[i].x, activos[i].y);
                    ctx.lineTo(activos[j].x, activos[j].y);
                    ctx.stroke();
                }
            }
        }

        for (const p of activos) {

            ctx.fillStyle = "rgba(" + COLOR + ", " + (0.6 + nivelSuavizado * 0.4) + ")";
            ctx.beginPath();
            ctx.arc(p.x, p.y, 1.6 + nivelSuavizado * 0.8, 0, Math.PI * 2);
            ctx.fill();
        }

        actualizarBrilloReactivo(nivelSuavizado);
    }


    function actualizarBrilloReactivo(nivel) {

        const elementos = document.querySelectorAll(".reactivo-audio");

        const intensidad = 14 + nivel * 46;
        const opacidad = 0.35 + nivel * 0.55;

        const sombra = "0 0 " + intensidad + "px rgba(" + COLOR + ", " + opacidad + ")";

        for (const el of elementos) {
            el.style.textShadow = sombra;
        }
    }


    window.FondoParticulas = {
        iniciar,
        conectarAnalizador
    };

})();
