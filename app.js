// ========================================
// LEDA · APLICACIÓN
// ========================================

(function () {
    "use strict";

    const $ = (id) => document.getElementById(id);

    const estado = {
        config: null,
        usuario: null,
        conversaciones: [],
        actual: null,            // { id, titulo, mensajes: [{ rol, contenido, fuentes, origen }] }
        enviando: false,
        abortador: null,
        adjuntos: [],            // archivos elegidos, todavía sin enviar
        bienvenidaNueva: false,  // recién creó su perfil: saludo de bienvenida
        filtro: "",
        archivoEnVista: null,
        ultimoFoco: null
    };

    // ----------------------------------------
    // Utilidades
    // ----------------------------------------

    function escapar(texto) {
        return String(texto)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    const ico = (nombre) => `<svg class="ico"><use href="#i-${nombre}"/></svg>`;

    class ErrorApi extends Error {
        constructor(mensaje, status) {
            super(mensaje);
            this.status = status;
        }
    }

    async function api(metodo, ruta, cuerpo) {
        const opciones = { method: metodo, headers: {} };

        if (cuerpo !== undefined) {
            opciones.headers["Content-Type"] = "application/json";
            opciones.body = JSON.stringify(cuerpo);
        }

        let respuesta;
        try {
            respuesta = await fetch(ruta, opciones);
        } catch (e) {
            throw new ErrorApi("No hay conexión con el servidor. Revisa tu internet.", 0);
        }

        let datos = null;
        try { datos = await respuesta.json(); } catch (e) { /* sin cuerpo */ }

        if (!respuesta.ok) {
            if (respuesta.status === 401 && estado.usuario) {
                estado.usuario = null;
                irALogin("Tu sesión venció. Inicia sesión de nuevo.");
            }
            throw new ErrorApi((datos && datos.error) || "Algo salió mal. Intenta de nuevo.", respuesta.status);
        }

        return datos;
    }

    let temporizadorToast = null;

    function toast(mensaje, ms = 4200) {
        const caja = $("toast");
        caja.textContent = mensaje;
        caja.hidden = false;
        clearTimeout(temporizadorToast);
        temporizadorToast = setTimeout(() => { caja.hidden = true; }, ms);
    }

    function saludoHora(fecha = new Date()) {
        const h = fecha.getHours();
        if (h >= 5 && h < 12) return "Buenos días";
        if (h >= 12 && h < 20) return "Buenas tardes";
        return "Buenas noches";
    }

    function bienvenidaTexto(genero) {
        if (genero === "hombre") return "Bienvenido";
        if (genero === "mujer") return "Bienvenida";
        return "Te damos la bienvenida";
    }

    function iniciales(usuario) {
        const a = (usuario.nombre || usuario.email || "?").trim()[0] || "?";
        return a.toUpperCase();
    }

    // ----------------------------------------
    // Tema claro / oscuro
    // ----------------------------------------

    const consultaOscuro = window.matchMedia("(prefers-color-scheme: dark)");

    function preferenciaTema() {
        try { return localStorage.getItem("leda-tema") || "auto"; } catch (e) { return "auto"; }
    }

    function aplicarTema(preferencia) {
        try { localStorage.setItem("leda-tema", preferencia); } catch (e) { /* sin almacenamiento */ }

        const oscuro = preferencia === "oscuro" || (preferencia === "auto" && consultaOscuro.matches);
        document.documentElement.dataset.tema = oscuro ? "oscuro" : "claro";

        // El botón de Google tiene su propio color: se vuelve a dibujar.
        if (!$("pantalla-login").hidden) dibujarBotonGoogle();
    }

    consultaOscuro.addEventListener("change", () => {
        if (preferenciaTema() === "auto") aplicarTema("auto");
    });

    // ----------------------------------------
    // Pantallas
    // ----------------------------------------

    function mostrar(pantalla) {
        $("pantalla-login").hidden = pantalla !== "login";
        $("pantalla-perfil").hidden = pantalla !== "perfil";
        $("app").hidden = pantalla !== "app";
        $("carga").hidden = true;
    }

    function irALogin(mensaje) {
        estado.usuario = null;
        estado.actual = null;
        estado.conversaciones = [];
        mostrar("login");
        dibujarBotonGoogle();

        if (mensaje) mostrarErrorLogin(mensaje);
    }

    function mostrarErrorLogin(mensaje) {
        const caja = $("login-error");
        caja.textContent = mensaje;
        caja.hidden = !mensaje;
    }

    // ----------------------------------------
    // Inicio de sesión con Google
    // ----------------------------------------

    let promesaGoogle = null;
    let googleIniciado = false;

    function cargarGoogle() {
        if (window.google && window.google.accounts) return Promise.resolve();

        if (!promesaGoogle) {
            promesaGoogle = new Promise((resolver, rechazar) => {
                const script = document.createElement("script");
                script.src = "https://accounts.google.com/gsi/client";
                script.async = true;
                script.defer = true;
                script.onload = resolver;
                script.onerror = () => {
                    promesaGoogle = null;
                    rechazar(new Error("No se pudo cargar el inicio de sesión de Google."));
                };
                document.head.appendChild(script);
            });
        }

        return promesaGoogle;
    }

    async function dibujarBotonGoogle() {
        const contenedor = $("google-boton");
        contenedor.innerHTML = "";

        if (!estado.config || !estado.config.googleClientId) {
            mostrarErrorLogin("Falta configurar el inicio de sesión con Google en el servidor (GOOGLE_CLIENT_ID).");
            return;
        }

        try {
            await cargarGoogle();
        } catch (e) {
            mostrarErrorLogin(e.message);
            return;
        }

        if (!googleIniciado) {
            window.google.accounts.id.initialize({
                client_id: estado.config.googleClientId,
                callback: alRecibirCredencial,
                ux_mode: "popup",
                auto_select: false
            });
            googleIniciado = true;
        }

        const oscuro = document.documentElement.dataset.tema === "oscuro";
        const ancho = Math.min(360, Math.max(240, (contenedor.parentElement.clientWidth || 360)));

        window.google.accounts.id.renderButton(contenedor, {
            type: "standard",
            theme: oscuro ? "filled_black" : "outline",
            size: "large",
            shape: "pill",
            text: "continue_with",
            locale: "es",
            width: ancho
        });
    }

    async function alRecibirCredencial(respuesta) {
        mostrarErrorLogin("");

        try {
            const datos = await api("POST", "/api/auth/google", { credential: respuesta.credential });
            entrarConUsuario(datos.usuario);
        } catch (e) {
            mostrarErrorLogin(e.message);
        }
    }

    // ----------------------------------------
    // Perfil (primera vez)
    // ----------------------------------------

    function valorGenero(nombreRadio) {
        const marcado = document.querySelector(`input[name="${nombreRadio}"]:checked`);
        return marcado ? marcado.value : "";
    }

    function actualizarVistaPrevia() {
        const nombre = $("perfil-nombre").value.trim() || "[Nombre]";
        const genero = valorGenero("genero");

        $("prev-saludo").textContent = `${saludoHora()}, ${nombre}`;

        const bienvenida = genero === "nodecir" ? "Te doy la bienvenida" : bienvenidaTexto(genero || "mujer");
        $("prev-bienvenida").textContent =
            `${genero ? bienvenida : "Bienvenido/a"}, ${nombre}. Soy LEDA, tu asistente de InfoNegocios. ¿En qué te ayudo hoy?`;
    }

    function mostrarErrorPerfil(mensaje) {
        const caja = $("perfil-error");
        caja.textContent = mensaje;
        caja.hidden = !mensaje;
    }

    async function guardarPerfilInicial(evento) {
        evento.preventDefault();
        mostrarErrorPerfil("");

        const nombre = $("perfil-nombre").value.trim();
        const apellido = $("perfil-apellido").value.trim();
        const genero = valorGenero("genero");

        if (!nombre || !apellido) return mostrarErrorPerfil("Escribe tu nombre y tu apellido.");
        if (!genero) return mostrarErrorPerfil("Elige una opción de género.");

        const boton = $("perfil-btn");
        boton.disabled = true;

        try {
            const datos = await api("PUT", "/api/perfil", { nombre, apellido, genero });
            estado.bienvenidaNueva = true;
            entrarConUsuario(datos.usuario);
        } catch (e) {
            mostrarErrorPerfil(e.message);
        } finally {
            boton.disabled = false;
        }
    }

    // ----------------------------------------
    // Entrada a la aplicación
    // ----------------------------------------

    function entrarConUsuario(usuario) {
        estado.usuario = usuario;
        aplicarTema(usuario.ajustes.tema || "auto");

        if (!usuario.perfilCompleto) {
            mostrar("perfil");
            actualizarVistaPrevia();
            $("perfil-nombre").focus();
            return;
        }

        mostrar("app");
        pintarPerfilLateral();
        nuevaConversacion();
        cargarConversaciones();
        iniciarMedicionRed();
    }

    function pintarPerfilLateral() {
        const u = estado.usuario;
        $("nombre-lateral").textContent = `${u.nombre} ${u.apellido}`.trim();
        $("correo-lateral").textContent = u.email;

        const avatar = $("avatar");
        if (u.foto) {
            avatar.style.backgroundImage = `url("${u.foto.replace(/"/g, "")}")`;
            avatar.textContent = "";
        } else {
            avatar.style.backgroundImage = "";
            avatar.textContent = iniciales(u);
        }
    }

    // ----------------------------------------
    // Markdown → HTML (seguro: todo se escapa primero)
    // ----------------------------------------

    function enLinea(texto) {
        let s = escapar(texto);
        const codigos = [];

        s = s.replace(/`([^`]+)`/g, (_, c) => {
            codigos.push(c);
            return `\u0000${codigos.length - 1}\u0000`;
        });

        s = s.replace(
            /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
            (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`
        );

        s = s.replace(
            /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
            (_, antes, u) => `${antes}<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`
        );

        s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, "$1<em>$2</em>");

        return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codigos[i]}</code>`);
    }

    function htmlLista(items) {
        let html = "";
        const pila = [];

        for (const it of items) {
            const etiqueta = it.ordenado ? "ol" : "ul";

            if (!pila.length) {
                html += `<${etiqueta}>`;
                pila.push({ sangria: it.sangria, etiqueta });
            } else {
                let tope = pila[pila.length - 1];

                if (it.sangria > tope.sangria) {
                    html += `<${etiqueta}>`;
                    pila.push({ sangria: it.sangria, etiqueta });
                } else {
                    while (pila.length > 1 && it.sangria < pila[pila.length - 1].sangria) {
                        html += `</li></${pila.pop().etiqueta}>`;
                    }
                    html += "</li>";
                    tope = pila[pila.length - 1];
                    if (tope.etiqueta !== etiqueta) {
                        html += `</${tope.etiqueta}><${etiqueta}>`;
                        tope.etiqueta = etiqueta;
                    }
                }
            }

            html += `<li>${enLinea(it.texto)}`;
        }

        while (pila.length) html += `</li></${pila.pop().etiqueta}>`;
        return html;
    }

    function markdown(texto) {
        const lineas = String(texto || "").replace(/\r\n?/g, "\n").split("\n");
        let html = "";
        let parrafo = [];
        let i = 0;

        const cerrarParrafo = () => {
            if (parrafo.length) {
                html += `<p>${enLinea(parrafo.join(" "))}</p>`;
                parrafo = [];
            }
        };

        const esTabla = (l) => /^\s*\|.*\|\s*$/.test(l);
        const esSeparador = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
        const partirFila = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

        while (i < lineas.length) {
            const linea = lineas[i];

            if (/^\s*```/.test(linea)) {
                cerrarParrafo();
                const codigo = [];
                i++;
                while (i < lineas.length && !/^\s*```/.test(lineas[i])) {
                    codigo.push(lineas[i]);
                    i++;
                }
                i++;
                html += `<pre><code>${escapar(codigo.join("\n"))}</code></pre>`;
                continue;
            }

            if (esTabla(linea) && i + 1 < lineas.length && esSeparador(lineas[i + 1])) {
                cerrarParrafo();
                const cabecera = partirFila(linea);
                i += 2;
                const filas = [];
                while (i < lineas.length && esTabla(lineas[i])) {
                    filas.push(partirFila(lineas[i]));
                    i++;
                }
                html += '<div class="tabla-caja"><table><thead><tr>' +
                    cabecera.map((c) => `<th>${enLinea(c)}</th>`).join("") +
                    "</tr></thead><tbody>" +
                    filas.map((f) => "<tr>" + cabecera.map((_, c) => `<td>${enLinea(f[c] || "")}</td>`).join("") + "</tr>").join("") +
                    "</tbody></table></div>";
                continue;
            }

            const titulo = linea.match(/^(#{1,3})\s+(.*)$/);
            if (titulo) {
                cerrarParrafo();
                html += `<h${titulo[1].length}>${enLinea(titulo[2])}</h${titulo[1].length}>`;
                i++;
                continue;
            }

            if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(linea)) {
                cerrarParrafo();
                html += "<hr>";
                i++;
                continue;
            }

            if (/^\s*>/.test(linea)) {
                cerrarParrafo();
                const cita = [];
                while (i < lineas.length && /^\s*>/.test(lineas[i])) {
                    cita.push(lineas[i].replace(/^\s*>\s?/, ""));
                    i++;
                }
                html += `<blockquote>${enLinea(cita.join(" "))}</blockquote>`;
                continue;
            }

            if (/^(\s*)([-*+]|\d+[.)])\s+/.test(linea)) {
                cerrarParrafo();
                const items = [];
                let m;
                while (i < lineas.length && (m = lineas[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/))) {
                    items.push({
                        sangria: Math.floor(m[1].replace(/\t/g, "  ").length / 2),
                        ordenado: /\d/.test(m[2]),
                        texto: m[3]
                    });
                    i++;
                }
                html += htmlLista(items);
                continue;
            }

            if (linea.trim() === "") {
                cerrarParrafo();
                i++;
                continue;
            }

            parrafo.push(linea.trim());
            i++;
        }

        cerrarParrafo();
        return html;
    }

    // ----------------------------------------
    // Historial (barra lateral)
    // ----------------------------------------

    async function cargarConversaciones() {
        try {
            const datos = await api("GET", "/api/conversaciones");
            estado.conversaciones = datos.conversaciones;
            pintarLista();
        } catch (e) {
            if (e.status !== 401) toast(e.message);
        }
    }

    function inicioDelDia(fecha) {
        return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()).getTime();
    }

    function pintarLista() {
        const contenedor = $("lista-conv");
        const filtro = estado.filtro.trim().toLowerCase();

        const lista = estado.conversaciones.filter((c) =>
            !filtro || c.titulo.toLowerCase().includes(filtro)
        );

        if (lista.length === 0) {
            contenedor.innerHTML = `<p class="sin-resultados">${
                filtro ? "No encontré conversaciones con ese texto." : "Todavía no tienes conversaciones."
            }</p>`;
            return;
        }

        const hoy = inicioDelDia(new Date());
        const DIA = 24 * 60 * 60 * 1000;

        const grupos = [
            { titulo: "HOY", items: [] },
            { titulo: "AYER", items: [] },
            { titulo: "ÚLTIMOS 7 DÍAS", items: [] },
            { titulo: "ANTERIORES", items: [] }
        ];

        for (const c of lista) {
            const dia = inicioDelDia(new Date(c.actualizada));
            if (dia >= hoy) grupos[0].items.push(c);
            else if (dia >= hoy - DIA) grupos[1].items.push(c);
            else if (dia >= hoy - 7 * DIA) grupos[2].items.push(c);
            else grupos[3].items.push(c);
        }

        contenedor.innerHTML = grupos
            .filter((g) => g.items.length)
            .map((g) =>
                `<span class="grupo-titulo">${g.titulo}</span>` +
                g.items.map((c) =>
                    `<div class="conv${estado.actual && estado.actual.id === c.id ? " activa" : ""}" data-id="${escapar(c.id)}">` +
                    `<button class="conv-titulo" data-accion="abrir" title="${escapar(c.titulo)}">${escapar(c.titulo)}</button>` +
                    `<span class="conv-acciones">` +
                    `<button class="icono-btn" data-accion="renombrar" aria-label="Cambiar el nombre">${ico("lapiz")}</button>` +
                    `<button class="icono-btn" data-accion="borrar" aria-label="Eliminar conversación">${ico("basura")}</button>` +
                    `</span></div>`
                ).join("")
            ).join("");
    }

    async function alClicLista(evento) {
        const boton = evento.target.closest("button[data-accion]");
        if (!boton) return;

        const id = boton.closest(".conv").dataset.id;
        const conv = estado.conversaciones.find((c) => c.id === id);
        if (!conv) return;

        const accion = boton.dataset.accion;

        if (accion === "abrir") {
            cerrarMenuMovil();
            return abrirConversacion(id);
        }

        if (accion === "renombrar") {
            const nuevo = window.prompt("Nuevo nombre de la conversación:", conv.titulo);
            if (nuevo === null || !nuevo.trim()) return;

            try {
                const datos = await api("PATCH", `/api/conversaciones/${id}`, { titulo: nuevo });
                conv.titulo = datos.titulo;
                if (estado.actual && estado.actual.id === id) {
                    estado.actual.titulo = datos.titulo;
                    $("titulo-conv").textContent = datos.titulo;
                }
                pintarLista();
            } catch (e) {
                toast(e.message);
            }
            return;
        }

        if (accion === "borrar") {
            if (!window.confirm(`¿Eliminar la conversación "${conv.titulo}"? No se puede deshacer.`)) return;

            try {
                await api("DELETE", `/api/conversaciones/${id}`);
                estado.conversaciones = estado.conversaciones.filter((c) => c.id !== id);
                if (estado.actual && estado.actual.id === id) nuevaConversacion();
                pintarLista();
            } catch (e) {
                toast(e.message);
            }
        }
    }

    // ----------------------------------------
    // Conversación actual
    // ----------------------------------------

    function definirModoVacio(vacio) {
        $("main").classList.toggle("vacio", vacio);
    }

    function pintarSaludo() {
        const u = estado.usuario;
        if (!u) return;

        if (estado.bienvenidaNueva) {
            $("saludo-titulo").textContent = `${bienvenidaTexto(u.genero)}, ${u.nombre}`;
            $("saludo-sub").textContent = "Soy LEDA, tu asistente de InfoNegocios. ¿En qué te ayudo hoy?";
        } else {
            $("saludo-titulo").textContent = `${saludoHora()}, ${u.nombre}`;
            $("saludo-sub").textContent = "¿En qué te ayudo hoy? Investigo, te paso links y creo archivos.";
        }
    }

    function nuevaConversacion() {
        if (estado.abortador) estado.abortador.abort();

        estado.actual = null;
        estado.adjuntos = [];
        pintarAdjuntos();
        pintarSeguimientos(false);
        $("mensajes").innerHTML = "";
        $("titulo-conv").textContent = "";
        $("entrada").value = "";
        ajustarEntrada();
        pintarSaludo();
        definirModoVacio(true);
        pintarLista();
        actualizarBotonEnvio();
    }

    async function abrirConversacion(id) {
        if (estado.abortador) estado.abortador.abort();

        try {
            const datos = await api("GET", `/api/conversaciones/${id}`);

            estado.actual = {
                id: datos.conversacion.id,
                titulo: datos.conversacion.titulo,
                mensajes: datos.mensajes.map((m) => ({
                    rol: m.rol,
                    contenido: m.contenido,
                    fuentes: m.fuentes || [],
                    origen: m.origen
                }))
            };

            estado.adjuntos = [];
            pintarAdjuntos();
            $("titulo-conv").textContent = estado.actual.titulo;
            definirModoVacio(false);
            pintarMensajes();
            pintarSeguimientos(true);
            pintarLista();
            bajarAlFinal(false);
            actualizarBotonEnvio();

        } catch (e) {
            toast(e.message);
        }
    }

    // ----------------------------------------
    // Mensajes en pantalla
    // ----------------------------------------

    const ETIQUETAS_TIPO = {
        docx: "Documento de Word",
        xlsx: "Hoja de cálculo de Excel",
        pdf: "Documento PDF",
        pptx: "Presentación de PowerPoint"
    };

    function etiquetaDeArchivo(spec) {
        if (ETIQUETAS_TIPO[spec.tipo]) return ETIQUETAS_TIPO[spec.tipo];
        const ext = (spec.nombre.match(/\.([A-Za-z0-9]+)$/) || [])[1];
        return ext ? `Archivo .${ext.toLowerCase()}` : "Archivo de texto";
    }

    function htmlMensajeUsuario(m) {
        const voz = m.origen === "voz"
            ? `<span class="etiqueta-voz">${ico("mic")} Por voz</span>` : "";

        return `<div class="msg-usuario">${voz}<div class="burbuja-usuario">${escapar(m.contenido)}</div></div>`;
    }

    // Fuentes de los archivos del mensaje: se guardan para los botones.
    let archivosPorMensaje = new WeakMap();

    function htmlCuerpoIA(m, { enCurso, ultimo }) {
        const partes = window.LedaArchivos.separarArchivos(m.contenido, { enCurso });
        archivosPorMensaje.set(m, partes.archivos);

        let html = "";

        if (m.origen === "voz") {
            html += `<span class="etiqueta-voz">${ico("mic")} Por voz</span>`;
        }

        if (!partes.texto && enCurso && !partes.creando) {
            html += '<div class="escribiendo" aria-label="LEDA está escribiendo"><span></span><span></span><span></span></div>';
        }

        if (partes.texto) {
            html += `<div class="md">${markdown(partes.texto)}</div>`;
        }

        if (partes.creando) {
            html += `<div class="estado-trabajo">${ico("archivo")} Creando el archivo...</div>`;
        }

        partes.archivos.forEach((spec, indice) => {
            html +=
                `<div class="archivo-card" data-indice="${indice}">` +
                `<div class="archivo-icono">${ico("archivo")}</div>` +
                `<div class="archivo-datos"><strong>${escapar(window.LedaArchivos.nombreFinal(spec))}</strong>` +
                `<span>${escapar(etiquetaDeArchivo(spec))}</span></div>` +
                `<div class="archivo-botones">` +
                `<button class="btn-borde" data-accion="vista">Vista previa</button>` +
                `<button class="btn-primario" data-accion="descargar">${ico("bajar")} Descargar</button>` +
                `</div></div>`;
        });

        if (!enCurso && m.fuentes && m.fuentes.length) {
            html +=
                '<div class="fuentes"><span class="fuentes-titulo">FUENTES</span><div class="fuentes-lista">' +
                m.fuentes.map((f) =>
                    `<a class="fuente" href="${escapar(f.url)}" target="_blank" rel="noopener noreferrer">` +
                    `${ico("enlace")}<span>${escapar(f.titulo)}</span></a>`
                ).join("") +
                "</div></div>";
        }

        if (!enCurso && m.contenido.trim()) {
            html +=
                '<div class="acciones">' +
                `<button class="icono-btn" data-accion="copiar" aria-label="Copiar respuesta">${ico("copiar")}</button>` +
                (ultimo ? `<button class="icono-btn" data-accion="regenerar" aria-label="Regenerar respuesta">${ico("repetir")}</button>` : "") +
                "</div>";
        }

        return html;
    }

    function crearNodoIA(m, opciones) {
        const nodo = document.createElement("div");
        nodo.className = "msg-ia";
        nodo.innerHTML = '<div class="logo chico">L</div><div class="msg-cuerpo"></div>';
        nodo.querySelector(".msg-cuerpo").innerHTML = htmlCuerpoIA(m, opciones);
        nodo._mensaje = m;
        return nodo;
    }

    function pintarMensajes() {
        const caja = $("mensajes");
        caja.innerHTML = "";

        const mensajes = estado.actual ? estado.actual.mensajes : [];
        const indiceUltimaIA = mensajes.map((m) => m.rol).lastIndexOf("model");

        mensajes.forEach((m, indice) => {
            if (m.rol === "user") {
                caja.insertAdjacentHTML("beforeend", htmlMensajeUsuario(m));
            } else {
                caja.appendChild(crearNodoIA(m, {
                    enCurso: false,
                    ultimo: indice === indiceUltimaIA && indice === mensajes.length - 1
                }));
            }
        });
    }

    function bajarAlFinal(suave = true) {
        const scroll = $("scroll");
        scroll.style.scrollBehavior = suave ? "smooth" : "auto";
        scroll.scrollTop = scroll.scrollHeight;
    }

    function estaCercaDelFinal() {
        const s = $("scroll");
        return s.scrollHeight - s.scrollTop - s.clientHeight < 140;
    }

    async function alClicMensajes(evento) {
        const boton = evento.target.closest("button[data-accion]");
        if (!boton) return;

        const nodo = boton.closest(".msg-ia");
        if (!nodo) return;

        const m = nodo._mensaje;
        const accion = boton.dataset.accion;

        if (accion === "copiar") {
            const { texto } = window.LedaArchivos.separarArchivos(m.contenido);
            try {
                await navigator.clipboard.writeText(texto);
                toast("Copiado", 1800);
            } catch (e) {
                toast("No se pudo copiar. Selecciona el texto y cópialo a mano.");
            }
            return;
        }

        if (accion === "regenerar") {
            return enviar({ regenerar: true });
        }

        const tarjeta = boton.closest(".archivo-card");
        if (tarjeta) {
            const spec = (archivosPorMensaje.get(m) || [])[Number(tarjeta.dataset.indice)];
            if (!spec) return;

            if (accion === "descargar") return descargarArchivo(spec, boton);
            if (accion === "vista") return abrirVistaPrevia(spec);
        }
    }

    async function descargarArchivo(spec, boton) {
        if (boton) boton.disabled = true;
        try {
            await window.LedaArchivos.descargar(spec);
        } catch (e) {
            toast(e.message || "No se pudo crear el archivo.");
        } finally {
            if (boton) boton.disabled = false;
        }
    }

    // ----------------------------------------
    // Vista previa de archivos
    // ----------------------------------------

    function htmlVistaPrevia(specCruda) {
        const spec = window.LedaArchivos.normalizarSpec(specCruda);

        if (spec.tipo === "docx" || spec.tipo === "pdf") {
            return markdown(spec.contenido);
        }

        if (spec.tipo === "xlsx") {
            return spec.hojas.map((hoja) => {
                const filas = Array.isArray(hoja.filas) ? hoja.filas : [];
                return `<h3>${escapar(hoja.nombre || "Hoja")}</h3><div class="tabla-caja"><table><tbody>` +
                    filas.map((f, i) =>
                        "<tr>" + (Array.isArray(f) ? f : [f]).map((c) =>
                            i === 0 ? `<th>${escapar(c ?? "")}</th>` : `<td>${escapar(c ?? "")}</td>`
                        ).join("") + "</tr>"
                    ).join("") +
                    "</tbody></table></div>";
            }).join("");
        }

        if (spec.tipo === "pptx") {
            return spec.diapositivas.map((d, i) =>
                `<h3>${i + 1}. ${escapar(d.titulo || "")}</h3>` +
                (Array.isArray(d.puntos) && d.puntos.length
                    ? "<ul>" + d.puntos.map((p) => `<li>${escapar(p)}</li>`).join("") + "</ul>" : "")
            ).join("");
        }

        return `<pre><code>${escapar(spec.contenido)}</code></pre>`;
    }

    function abrirVistaPrevia(spec) {
        estado.archivoEnVista = spec;
        $("preview-titulo").textContent = window.LedaArchivos.nombreFinal(spec);
        $("preview-cuerpo").innerHTML = htmlVistaPrevia(spec);
        abrirModal("preview-modal");
    }

    // ----------------------------------------
    // Envío de mensajes
    // ----------------------------------------

    function actualizarBotonEnvio() {
        const boton = $("btn-enviar");

        if (estado.enviando) {
            boton.disabled = false;
            boton.innerHTML = ico("parar");
            boton.setAttribute("aria-label", "Detener respuesta");
            return;
        }

        boton.innerHTML = ico("enviar");
        boton.setAttribute("aria-label", "Enviar mensaje");
        boton.disabled = !$("entrada").value.trim() && estado.adjuntos.length === 0;
    }

    function ajustarEntrada() {
        const campo = $("entrada");
        campo.style.height = "auto";
        campo.style.height = Math.min(campo.scrollHeight, 200) + "px";
    }

    const SUGERENCIAS_SEGUIMIENTO = [
        "Hazlo más corto",
        "Tradúcelo al inglés",
        "Conviértelo en presentación"
    ];

    function pintarSeguimientos(mostrar) {
        const caja = $("seguimientos");
        const hayRespuesta = estado.actual && estado.actual.mensajes.length &&
            estado.actual.mensajes[estado.actual.mensajes.length - 1].rol === "model";

        if (!mostrar || !hayRespuesta || estado.enviando) {
            caja.hidden = true;
            caja.innerHTML = "";
            return;
        }

        caja.innerHTML = SUGERENCIAS_SEGUIMIENTO
            .map((t) => `<button type="button" class="sugerencia">${escapar(t)}</button>`)
            .join("");
        caja.hidden = false;
    }

    // Convierte los archivos elegidos al formato que espera el servidor.
    const EXTENSIONES_TEXTO = ["txt", "md", "csv", "json", "html", "xml", "js", "py", "css", "log"];
    const MAX_BYTES_ADJUNTO = 5 * 1024 * 1024;

    function leerComoBase64(archivo) {
        return new Promise((resolver, rechazar) => {
            const lector = new FileReader();
            lector.onload = () => resolver(String(lector.result).split(",")[1] || "");
            lector.onerror = () => rechazar(new Error(`No pude leer "${archivo.name}".`));
            lector.readAsDataURL(archivo);
        });
    }

    async function prepararAdjuntos() {
        const salida = [];

        for (const archivo of estado.adjuntos) {
            const extension = (archivo.name.split(".").pop() || "").toLowerCase();
            const esTexto = archivo.type.startsWith("text/") || EXTENSIONES_TEXTO.includes(extension);

            if (esTexto) {
                salida.push({ nombre: archivo.name, texto: (await archivo.text()).slice(0, 200000) });
            } else {
                salida.push({
                    nombre: archivo.name,
                    mime: archivo.type,
                    base64: await leerComoBase64(archivo)
                });
            }
        }

        return salida;
    }

    function agregarArchivos(lista) {
        for (const archivo of lista) {
            if (estado.adjuntos.length >= 4) {
                toast("Puedes adjuntar hasta 4 archivos por mensaje.");
                break;
            }

            if (archivo.size > MAX_BYTES_ADJUNTO) {
                toast(`"${archivo.name}" es demasiado grande (máximo 5 MB).`);
                continue;
            }

            const extension = (archivo.name.split(".").pop() || "").toLowerCase();
            const permitido =
                /^image\/(png|jpeg|webp|gif)$/.test(archivo.type) ||
                archivo.type === "application/pdf" ||
                archivo.type.startsWith("text/") ||
                EXTENSIONES_TEXTO.includes(extension);

            if (!permitido) {
                toast(`No puedo leer "${archivo.name}". Prueba con imágenes, PDF o archivos de texto.`);
                continue;
            }

            estado.adjuntos.push(archivo);
        }

        pintarAdjuntos();
        actualizarBotonEnvio();
    }

    function pintarAdjuntos() {
        const caja = $("adjuntos-lista");

        if (estado.adjuntos.length === 0) {
            caja.hidden = true;
            caja.innerHTML = "";
            return;
        }

        caja.innerHTML = estado.adjuntos.map((a, i) =>
            `<span class="adjunto">${ico("archivo")}<span>${escapar(a.name)}</span>` +
            `<button type="button" class="icono-btn" data-quitar="${i}" aria-label="Quitar ${escapar(a.name)}">${ico("cerrar")}</button></span>`
        ).join("");
        caja.hidden = false;
    }

    let renderPendiente = false;

    function programarRender(nodo, mensaje) {
        if (renderPendiente) return;
        renderPendiente = true;

        requestAnimationFrame(() => {
            renderPendiente = false;
            const seguir = estaCercaDelFinal();
            nodo.querySelector(".msg-cuerpo").innerHTML = htmlCuerpoIA(mensaje, { enCurso: true, ultimo: false });
            if (seguir) bajarAlFinal(false);
        });
    }

    async function leerStream(respuesta, alEvento) {
        const lector = respuesta.body.getReader();
        const decodificador = new TextDecoder();
        let pendiente = "";

        while (true) {
            const { done, value } = await lector.read();
            if (done) break;

            pendiente += decodificador.decode(value, { stream: true });

            let corte;
            while ((corte = pendiente.search(/\n\n/)) !== -1) {
                const bloque = pendiente.slice(0, corte);
                pendiente = pendiente.slice(corte + 2);

                const linea = bloque.split("\n").find((l) => l.startsWith("data:"));
                if (!linea) continue;

                try {
                    alEvento(JSON.parse(linea.slice(5)));
                } catch (e) { /* evento ilegible: se ignora */ }
            }
        }
    }

    async function enviar({ texto = "", regenerar = false } = {}) {
        if (estado.enviando) return;
        if (!estado.usuario) return;

        texto = texto.trim();

        if (!regenerar && !texto && estado.adjuntos.length === 0) return;

        let adjuntos = [];

        if (!regenerar) {
            try {
                adjuntos = await prepararAdjuntos();
            } catch (e) {
                return toast(e.message);
            }
        }

        estado.enviando = true;
        estado.bienvenidaNueva = false;
        pintarSeguimientos(false);

        if (!estado.actual) estado.actual = { id: null, titulo: "", mensajes: [] };

        definirModoVacio(false);

        const caja = $("mensajes");

        if (regenerar) {
            // Quitamos la última respuesta de LEDA, que se va a volver a pedir.
            const ultima = estado.actual.mensajes[estado.actual.mensajes.length - 1];
            if (ultima && ultima.rol === "model") {
                estado.actual.mensajes.pop();
                const nodos = caja.querySelectorAll(".msg-ia");
                if (nodos.length) nodos[nodos.length - 1].remove();
            }
        } else {
            const nombres = adjuntos.map((a) => a.nombre);
            const contenido = nombres.length
                ? `${texto}${texto ? "\n\n" : ""}[Adjuntos: ${nombres.join(", ")}]`
                : texto;

            const mensajeUsuario = { rol: "user", contenido, fuentes: [], origen: "texto" };
            estado.actual.mensajes.push(mensajeUsuario);
            caja.insertAdjacentHTML("beforeend", htmlMensajeUsuario(mensajeUsuario));

            $("entrada").value = "";
            ajustarEntrada();
            estado.adjuntos = [];
            pintarAdjuntos();
        }

        const mensajeIA = { rol: "model", contenido: "", fuentes: [], origen: "texto" };
        estado.actual.mensajes.push(mensajeIA);

        const nodoIA = crearNodoIA(mensajeIA, { enCurso: true, ultimo: false });
        caja.appendChild(nodoIA);
        bajarAlFinal(false);

        const controlador = new AbortController();
        estado.abortador = controlador;
        actualizarBotonEnvio();

        const conversacion = estado.actual;
        let huboError = false;

        try {
            const respuesta = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    conversacionId: conversacion.id,
                    mensaje: texto,
                    adjuntos,
                    regenerar
                }),
                signal: controlador.signal
            });

            const tipo = respuesta.headers.get("content-type") || "";

            if (!respuesta.ok || !tipo.includes("text/event-stream")) {
                let datos = null;
                try { datos = await respuesta.json(); } catch (e) { /* sin cuerpo */ }

                if (respuesta.status === 401) {
                    estado.usuario = null;
                    irALogin("Tu sesión venció. Inicia sesión de nuevo.");
                    return;
                }

                throw new Error((datos && datos.error) || "No se pudo enviar el mensaje.");
            }

            await leerStream(respuesta, (evento) => {

                if (evento.t === "inicio") {
                    conversacion.id = evento.conversacionId;
                    conversacion.titulo = evento.titulo;
                    if (estado.actual === conversacion) $("titulo-conv").textContent = evento.titulo;
                }

                if (evento.t === "delta") {
                    mensajeIA.contenido += evento.texto;
                    programarRender(nodoIA, mensajeIA);
                }

                if (evento.t === "fin") {
                    mensajeIA.fuentes = evento.fuentes || [];
                }

                if (evento.t === "error") {
                    huboError = true;
                    mensajeIA.error = evento.mensaje;
                }
            });

        } catch (e) {
            if (e.name !== "AbortError") {
                huboError = true;
                mensajeIA.error = e.message;
            }
        } finally {
            estado.enviando = false;
            estado.abortador = null;
        }

        // Si cambió de conversación mientras respondía, no tocamos la pantalla.
        if (estado.actual !== conversacion) {
            cargarConversaciones();
            return;
        }

        if (!mensajeIA.contenido.trim()) {
            // Respuesta vacía: se quita y se muestra el motivo.
            conversacion.mensajes.pop();
            nodoIA.remove();
        } else {
            renderPendiente = false;
            nodoIA.querySelector(".msg-cuerpo").innerHTML =
                htmlCuerpoIA(mensajeIA, { enCurso: false, ultimo: true });
        }

        if (huboError) {
            const aviso = document.createElement("div");
            aviso.className = "msg-error";
            aviso.textContent = mensajeIA.error || "No se pudo completar la respuesta.";
            caja.appendChild(aviso);
        }

        actualizarBotonEnvio();
        pintarSeguimientos(!huboError);
        bajarAlFinal(true);
        cargarConversaciones();
    }

    // ----------------------------------------
    // Modo voz
    // ----------------------------------------

    let temporizadorVoz = null;
    let cuadroVoz = null;
    let inicioVoz = 0;
    let colaGuardadoVoz = Promise.resolve();

    const TEXTOS_VOZ = {
        conectando: "Conectando...",
        escuchando: "Escuchando...",
        procesando: "Procesando respuesta...",
        hablando: "LEDA está hablando...",
        reconectando: "Reconectando..."
    };

    function ponerEstadoVoz(nombre) {
        const voz = $("voz");
        voz.className = `voz estado-${nombre}`;
        $("voz-estado-texto").textContent = TEXTOS_VOZ[nombre] || "";
    }

    function ponerSubtitulo(quien, texto) {
        const caja = $("voz-subtitulo");
        caja.innerHTML = `<span class="quien">${escapar(quien.toUpperCase())}</span>${escapar(texto)}`;
    }

    function formatoTiempo(segundos) {
        const m = String(Math.floor(segundos / 60)).padStart(2, "0");
        const s = String(segundos % 60).padStart(2, "0");
        return `${m}:${s}`;
    }

    function iniciarVoz() {
        if (window.LedaVoz.activa() || !estado.usuario) return;

        $("voz").hidden = false;
        $("voz-subtitulo").innerHTML = "";
        $("voz-silenciar").setAttribute("aria-pressed", "false");
        $("voz-silenciar").setAttribute("aria-label", "Silenciar micrófono");
        ponerEstadoVoz("conectando");

        inicioVoz = Date.now();
        $("voz-tiempo").textContent = "00:00";
        temporizadorVoz = setInterval(() => {
            $("voz-tiempo").textContent = formatoTiempo(Math.floor((Date.now() - inicioVoz) / 1000));
        }, 1000);

        const animar = () => {
            if ($("voz").hidden) return;
            $("voz-orbe").style.setProperty("--nivel", window.LedaVoz.nivel().toFixed(3));
            cuadroVoz = requestAnimationFrame(animar);
        };
        cuadroVoz = requestAnimationFrame(animar);

        const nombre = estado.usuario.nombre;

        // Importante: se llama de forma síncrona dentro del clic, para que
        // el navegador permita el audio.
        window.LedaVoz.iniciar({
            pedirToken: () => api("POST", "/api/voz-token"),
            disparador: `Salúdame brevemente diciendo "${saludoHora()}, ${nombre}" y pregúntame en qué puedes ayudarme.`,
            onEstado: ponerEstadoVoz,
            onUsuario: (t) => ponerSubtitulo("Tú", t),
            onModelo: (t) => ponerSubtitulo("LEDA", t),
            onTurno: guardarTurnoVoz,
            onError: (mensaje) => { cerrarVoz(); toast(mensaje, 6000); },
            onFin: (motivo) => {
                cerrarVoz();
                if (motivo === "conexion") toast("Se cortó la conversación por voz.");
            }
        });
    }

    function cerrarVoz() {
        clearInterval(temporizadorVoz);
        cancelAnimationFrame(cuadroVoz);
        $("voz").hidden = true;
        $("voz-orbe").style.setProperty("--nivel", "0");

        // Esperamos a que termine de guardarse el último turno y mostramos
        // la conversación que quedó.
        colaGuardadoVoz.then(() => {
            if (estado.actual && estado.actual.mensajes.length) {
                $("titulo-conv").textContent = estado.actual.titulo;
                definirModoVacio(false);
                pintarMensajes();
                pintarSeguimientos(false);
                bajarAlFinal(false);
            }
            cargarConversaciones();
        });
    }

    function guardarTurnoVoz({ usuario, modelo }) {
        const mensajes = [];
        if (usuario) mensajes.push({ rol: "user", contenido: usuario });
        if (modelo) mensajes.push({ rol: "model", contenido: modelo });
        if (!mensajes.length) return;

        // Se guardan de a uno, en orden, para no crear conversaciones duplicadas.
        colaGuardadoVoz = colaGuardadoVoz.then(async () => {
            try {
                const datos = await api("POST", "/api/mensajes", {
                    conversacionId: estado.actual ? estado.actual.id : null,
                    mensajes
                });

                if (!estado.actual) estado.actual = { id: null, titulo: "", mensajes: [] };
                estado.actual.id = datos.conversacionId;
                estado.actual.titulo = datos.titulo;

                for (const m of mensajes) {
                    estado.actual.mensajes.push({ ...m, fuentes: [], origen: "voz" });
                }
            } catch (e) {
                toast("No se pudo guardar un turno de la conversación por voz.");
            }
        });
    }

    // ----------------------------------------
    // Ventanas
    // ----------------------------------------

    function abrirModal(id) {
        estado.ultimoFoco = document.activeElement;
        const modal = $(id);
        modal.hidden = false;
        const foco = modal.querySelector("button, input");
        if (foco) foco.focus();
    }

    function cerrarModal(id) {
        $(id).hidden = true;
        if (estado.ultimoFoco && document.contains(estado.ultimoFoco)) estado.ultimoFoco.focus();
    }

    function cerrarMenuMovil() {
        $("sidebar").classList.remove("abierta");
        $("fondo-drawer").classList.remove("visible");
    }

    function abrirMenuMovil() {
        $("sidebar").classList.add("abierta");
        $("fondo-drawer").classList.add("visible");
    }

    // ---- Ajustes ----

    function pintarAjustes() {
        const a = estado.usuario.ajustes;

        document.querySelectorAll(".pildoras").forEach((grupo) => {
            const clave = grupo.dataset.ajuste;
            grupo.querySelectorAll("button").forEach((b) => {
                b.setAttribute("aria-pressed", String(b.dataset.valor === a[clave]));
            });
        });

        document.querySelectorAll("[data-interruptor]").forEach((b) => {
            b.setAttribute("aria-checked", String(Boolean(a[b.dataset.interruptor])));
        });

        $("aj-nombre").value = estado.usuario.nombre;
        $("aj-apellido").value = estado.usuario.apellido;

        const radio = document.querySelector(`input[name="aj-genero"][value="${estado.usuario.genero}"]`);
        if (radio) radio.checked = true;
    }

    function mostrarPanelAjustes(nombre) {
        document.querySelectorAll(".pestana").forEach((p) => {
            p.classList.toggle("activa", p.dataset.panel === nombre);
        });
        document.querySelectorAll(".ajustes-panel").forEach((p) => {
            p.hidden = p.dataset.panel !== nombre;
        });
        const titulos = { general: "General", perfil: "Perfil", datos: "Datos y privacidad" };
        $("ajustes-seccion").textContent = titulos[nombre];
    }

    async function cambiarAjuste(cambio) {
        try {
            const datos = await api("PATCH", "/api/ajustes", cambio);
            estado.usuario = datos.usuario;
            pintarAjustes();
        } catch (e) {
            toast(e.message);
            pintarAjustes();
        }
    }

    async function guardarPerfilDesdeAjustes(evento) {
        evento.preventDefault();

        const caja = $("aj-perfil-error");
        caja.hidden = true;

        const nombre = $("aj-nombre").value.trim();
        const apellido = $("aj-apellido").value.trim();
        const genero = valorGenero("aj-genero");

        if (!nombre || !apellido || !genero) {
            caja.textContent = "Completa nombre, apellido y género.";
            caja.hidden = false;
            return;
        }

        try {
            const datos = await api("PUT", "/api/perfil", { nombre, apellido, genero });
            estado.usuario = datos.usuario;
            pintarPerfilLateral();
            if ($("main").classList.contains("vacio")) pintarSaludo();
            toast("Perfil actualizado", 2200);
        } catch (e) {
            caja.textContent = e.message;
            caja.hidden = false;
        }
    }

    async function exportarDatos() {
        try {
            const respuesta = await fetch("/api/exportar");
            if (!respuesta.ok) throw new Error("No se pudieron exportar los datos.");

            const blob = await respuesta.blob();
            const enlace = document.createElement("a");
            enlace.href = URL.createObjectURL(blob);
            enlace.download = "mis-datos-leda.json";
            document.body.appendChild(enlace);
            enlace.click();
            enlace.remove();
            setTimeout(() => URL.revokeObjectURL(enlace.href), 10000);
        } catch (e) {
            toast(e.message);
        }
    }

    async function cerrarSesion() {
        try { await api("POST", "/api/auth/salir"); } catch (e) { /* igual salimos */ }
        cerrarModal("ajustes");
        irALogin();
    }

    async function borrarCuenta() {
        if (!window.confirm("¿Eliminar tu cuenta y todo tu historial? Esta acción no se puede deshacer.")) return;
        if (!window.confirm("Última confirmación: se borrarán tus conversaciones y tu perfil para siempre.")) return;

        try {
            await api("DELETE", "/api/cuenta");
            cerrarModal("ajustes");
            irALogin();
            toast("Tu cuenta fue eliminada.");
        } catch (e) {
            toast(e.message);
        }
    }

    // ---- Archivos creados ----

    async function abrirArchivos() {
        cerrarMenuMovil();
        abrirModal("archivos-modal");

        const lista = $("archivos-lista");
        lista.innerHTML = '<p class="vacio-aviso">Cargando...</p>';

        try {
            const datos = await api("GET", "/api/archivos");

            if (!datos.archivos.length) {
                lista.innerHTML = '<p class="vacio-aviso">Todavía no creé ningún archivo para ti.<br>Pídele a LEDA un documento, una planilla o un PDF.</p>';
                return;
            }

            estado.archivosListados = datos.archivos;

            lista.innerHTML = datos.archivos.map((a, i) =>
                `<div class="archivo-fila" data-i="${i}">` +
                `<div class="archivo-icono">${ico("archivo")}</div>` +
                `<div class="archivo-datos"><strong>${escapar(window.LedaArchivos.nombreFinal(a.spec))}</strong>` +
                `<span>${escapar(etiquetaDeArchivo(a.spec))} · ${escapar(a.conversacionTitulo)}</span></div>` +
                `<button class="icono-btn" data-accion="vista" aria-label="Vista previa">${ico("ojo")}</button>` +
                `<button class="icono-btn" data-accion="descargar" aria-label="Descargar">${ico("bajar")}</button>` +
                `<button class="icono-btn" data-accion="ir" aria-label="Abrir la conversación">${ico("nuevo")}</button>` +
                `</div>`
            ).join("");

        } catch (e) {
            lista.innerHTML = `<p class="vacio-aviso">${escapar(e.message)}</p>`;
        }
    }

    function alClicArchivos(evento) {
        const boton = evento.target.closest("button[data-accion]");
        if (!boton) return;

        const fila = boton.closest(".archivo-fila");
        const archivo = estado.archivosListados[Number(fila.dataset.i)];
        if (!archivo) return;

        const accion = boton.dataset.accion;

        if (accion === "descargar") return descargarArchivo(archivo.spec, boton);
        if (accion === "vista") return abrirVistaPrevia(archivo.spec);

        if (accion === "ir") {
            cerrarModal("archivos-modal");
            abrirConversacion(archivo.conversacionId);
        }
    }

    // ----------------------------------------
    // Indicador de conexión
    // ----------------------------------------

    let intervaloRed = null;

    async function medirConexion() {
        const inicio = performance.now();
        let nivel;

        try {
            await fetch("/api/config?_=" + Date.now(), { cache: "no-store" });
            const ms = performance.now() - inicio;
            nivel = ms >= 400 ? 1 : ms >= 150 ? 2 : 3;
        } catch (e) {
            nivel = 1;
        }

        const caja = $("indicador-red");
        caja.className = "senal" + (nivel === 1 ? " mala" : nivel === 2 ? " regular" : "");
        caja.querySelectorAll("span").forEach((barra, i) => barra.classList.toggle("activa", i < nivel));
        caja.setAttribute("aria-label", `Calidad de conexión: ${["", "baja", "regular", "buena"][nivel]}`);
    }

    function iniciarMedicionRed() {
        if (intervaloRed) return;
        medirConexion();
        intervaloRed = setInterval(medirConexion, 8000);
    }

    // ----------------------------------------
    // Eventos
    // ----------------------------------------

    function conectarEventos() {

        // Perfil inicial
        $("form-perfil").addEventListener("submit", guardarPerfilInicial);
        $("perfil-nombre").addEventListener("input", actualizarVistaPrevia);
        document.querySelectorAll('input[name="genero"]').forEach((r) =>
            r.addEventListener("change", actualizarVistaPrevia)
        );
        $("form-perfil").addEventListener("input", () => mostrarErrorPerfil(""));
        $("form-perfil").addEventListener("change", () => mostrarErrorPerfil(""));

        // Barra lateral
        $("btn-nuevo").addEventListener("click", () => { cerrarMenuMovil(); nuevaConversacion(); $("entrada").focus(); });
        $("btn-nuevo-movil").addEventListener("click", () => { nuevaConversacion(); $("entrada").focus(); });
        $("btn-menu").addEventListener("click", abrirMenuMovil);
        $("btn-cerrar-sidebar").addEventListener("click", cerrarMenuMovil);
        $("fondo-drawer").addEventListener("click", cerrarMenuMovil);
        $("lista-conv").addEventListener("click", alClicLista);
        $("buscar").addEventListener("input", (e) => { estado.filtro = e.target.value; pintarLista(); });
        $("btn-archivos").addEventListener("click", abrirArchivos);
        $("btn-ajustes").addEventListener("click", () => {
            cerrarMenuMovil();
            pintarAjustes();
            mostrarPanelAjustes("general");
            abrirModal("ajustes");
        });

        // Chat
        $("mensajes").addEventListener("click", alClicMensajes);

        $("form-chat").addEventListener("submit", (e) => {
            e.preventDefault();

            if (estado.enviando) {
                if (estado.abortador) estado.abortador.abort();
                return;
            }

            enviar({ texto: $("entrada").value });
        });

        $("entrada").addEventListener("input", () => { ajustarEntrada(); actualizarBotonEnvio(); });

        $("entrada").addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                if (!estado.enviando) $("form-chat").requestSubmit();
            }
        });

        $("btn-adjuntar").addEventListener("click", () => $("archivo-input").click());

        $("archivo-input").addEventListener("change", (e) => {
            agregarArchivos(Array.from(e.target.files));
            e.target.value = "";
        });

        $("adjuntos-lista").addEventListener("click", (e) => {
            const boton = e.target.closest("[data-quitar]");
            if (!boton) return;
            estado.adjuntos.splice(Number(boton.dataset.quitar), 1);
            pintarAdjuntos();
            actualizarBotonEnvio();
        });

        $("seguimientos").addEventListener("click", (e) => {
            const boton = e.target.closest(".sugerencia");
            if (boton) enviar({ texto: boton.textContent });
        });

        $("tiles").addEventListener("click", (e) => {
            const tile = e.target.closest(".tile");
            if (tile) enviar({ texto: tile.dataset.prompt });
        });

        // Soltar archivos sobre la pantalla
        $("main").addEventListener("dragover", (e) => e.preventDefault());
        $("main").addEventListener("drop", (e) => {
            e.preventDefault();
            if (e.dataTransfer && e.dataTransfer.files.length) agregarArchivos(Array.from(e.dataTransfer.files));
        });

        // Voz
        $("btn-voz").addEventListener("click", iniciarVoz);
        $("voz-fin").addEventListener("click", () => window.LedaVoz.detener("usuario"));
        $("voz-escribir").addEventListener("click", () => {
            window.LedaVoz.detener("usuario");
            setTimeout(() => $("entrada").focus(), 50);
        });
        $("voz-silenciar").addEventListener("click", (e) => {
            const boton = e.currentTarget;
            const silenciado = boton.getAttribute("aria-pressed") !== "true";
            boton.setAttribute("aria-pressed", String(silenciado));
            boton.setAttribute("aria-label", silenciado ? "Activar micrófono" : "Silenciar micrófono");
            window.LedaVoz.silenciar(silenciado);
        });

        // Ventanas
        document.querySelectorAll("[data-cerrar]").forEach((b) =>
            b.addEventListener("click", () => cerrarModal(b.dataset.cerrar))
        );

        document.querySelectorAll(".modal-fondo").forEach((fondo) =>
            fondo.addEventListener("mousedown", (e) => { if (e.target === fondo) cerrarModal(fondo.id); })
        );

        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;

            const abierto = Array.from(document.querySelectorAll(".modal-fondo")).find((m) => !m.hidden);
            if (abierto) return cerrarModal(abierto.id);

            if ($("sidebar").classList.contains("abierta")) cerrarMenuMovil();
        });

        document.querySelectorAll(".pestana").forEach((p) =>
            p.addEventListener("click", () => mostrarPanelAjustes(p.dataset.panel))
        );

        document.querySelectorAll(".pildoras").forEach((grupo) =>
            grupo.addEventListener("click", (e) => {
                const boton = e.target.closest("button[data-valor]");
                if (!boton) return;

                const clave = grupo.dataset.ajuste;
                if (clave === "tema") aplicarTema(boton.dataset.valor);
                cambiarAjuste({ [clave]: boton.dataset.valor });
            })
        );

        document.querySelectorAll("[data-interruptor]").forEach((b) =>
            b.addEventListener("click", () => {
                const nuevo = b.getAttribute("aria-checked") !== "true";
                cambiarAjuste({ [b.dataset.interruptor]: nuevo });
            })
        );

        $("form-ajustes-perfil").addEventListener("submit", guardarPerfilDesdeAjustes);
        $("btn-exportar").addEventListener("click", exportarDatos);
        $("btn-cerrar-sesion").addEventListener("click", cerrarSesion);
        $("btn-borrar-cuenta").addEventListener("click", borrarCuenta);

        $("preview-descargar").addEventListener("click", (e) => {
            if (estado.archivoEnVista) descargarArchivo(estado.archivoEnVista, e.currentTarget);
        });
    }

    // ----------------------------------------
    // Arranque
    // ----------------------------------------

    function ajustarTextoDeLaBarra() {
        $("entrada").placeholder = window.innerWidth <= 900
            ? "Escribe a LEDA..."
            : "Pregúntale lo que quieras a LEDA...";
    }

    async function arrancar() {
        conectarEventos();
        ajustarTextoDeLaBarra();
        window.addEventListener("resize", ajustarTextoDeLaBarra);

        try {
            estado.config = await api("GET", "/api/config");
            const datos = await api("GET", "/api/me");

            if (datos.usuario) {
                entrarConUsuario(datos.usuario);
            } else {
                irALogin();
            }
        } catch (e) {
            irALogin(e.message);
        }
    }

    arrancar();

})();
