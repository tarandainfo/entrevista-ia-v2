// ========================================
// GENERADOR DE ARCHIVOS (EN EL NAVEGADOR)
// ========================================
//
// LEDA no crea los archivos en el servidor: devuelve una
// "especificación" (JSON dentro de un bloque ```leda-archivo```)
// y este módulo la convierte en un archivo real para descargar.
// Las librerías pesadas se cargan recién cuando hacen falta.

(function (global) {

    // ----------------------------------------
    // Carga perezosa de librerías
    // ----------------------------------------

    const LIBRERIAS = {
        jszip: {
            global: "JSZip",
            url: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"
        },
        xlsx: {
            global: "XLSX",
            url: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"
        },
        jspdf: {
            global: "jspdf",
            url: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
        },
        pptx: {
            global: "PptxGenJS",
            url: "https://cdnjs.cloudflare.com/ajax/libs/pptxgenjs/3.12.0/pptxgen.bundle.js"
        }
    };

    const cargasEnCurso = {};

    function cargarLibreria(nombre) {
        const lib = LIBRERIAS[nombre];

        if (global[lib.global]) {
            return Promise.resolve(global[lib.global]);
        }

        if (!cargasEnCurso[nombre]) {
            cargasEnCurso[nombre] = new Promise((resolver, rechazar) => {
                const script = document.createElement("script");
                script.src = lib.url;
                script.onload = () => resolver(global[lib.global]);
                script.onerror = () => {
                    delete cargasEnCurso[nombre];
                    rechazar(new Error(
                        "No se pudo cargar lo necesario para crear el archivo. Revisa tu conexión."
                    ));
                };
                document.head.appendChild(script);
            });
        }

        return cargasEnCurso[nombre];
    }

    // ----------------------------------------
    // Especificación y nombres
    // ----------------------------------------

    const EXTENSION_POR_TIPO = { docx: "docx", pdf: "pdf", xlsx: "xlsx", pptx: "pptx" };

    const MIME_POR_EXTENSION = {
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        pdf: "application/pdf",
        csv: "text/csv;charset=utf-8",
        json: "application/json;charset=utf-8",
        html: "text/html;charset=utf-8",
        md: "text/markdown;charset=utf-8",
        txt: "text/plain;charset=utf-8"
    };

    function normalizarSpec(spec) {
        const tipo = String((spec && spec.tipo) || "txt").toLowerCase();
        const nombre = String((spec && spec.nombre) || "archivo");

        if (tipo === "xlsx") {
            let hojas = Array.isArray(spec.hojas) ? spec.hojas : [];
            if (hojas.length === 0 && Array.isArray(spec.filas)) {
                hojas = [{ nombre: "Hoja1", filas: spec.filas }];
            }
            return { tipo, nombre, hojas };
        }

        if (tipo === "pptx") {
            return {
                tipo,
                nombre,
                diapositivas: Array.isArray(spec.diapositivas) ? spec.diapositivas : []
            };
        }

        return {
            tipo: EXTENSION_POR_TIPO[tipo] ? tipo : "txt",
            nombre,
            contenido: typeof spec.contenido === "string" ? spec.contenido : ""
        };
    }

    function nombreFinal(spec) {
        const s = normalizarSpec(spec);

        let nombre = s.nombre
            .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, "_")
            .replace(/^\.+/, "")
            .trim()
            .slice(0, 100);

        if (!nombre) nombre = "archivo";

        const extensionNecesaria = EXTENSION_POR_TIPO[s.tipo];

        if (extensionNecesaria) {
            const re = new RegExp("\\." + extensionNecesaria + "$", "i");
            if (!re.test(nombre)) {
                nombre = nombre.replace(/\.[A-Za-z0-9]{1,5}$/, "") + "." + extensionNecesaria;
            }
        } else if (!/\.[A-Za-z0-9]{1,8}$/.test(nombre)) {
            nombre += ".txt";
        }

        return nombre;
    }

    function extensionDe(nombre) {
        const m = nombre.match(/\.([A-Za-z0-9]+)$/);
        return m ? m[1].toLowerCase() : "txt";
    }

    // ----------------------------------------
    // Markdown simple → bloques
    // ----------------------------------------

    function parsearMarkdown(texto) {
        const lineas = String(texto || "").replace(/\r\n?/g, "\n").split("\n");
        const bloques = [];
        let i = 0;
        let parrafo = [];

        const cerrarParrafo = () => {
            if (parrafo.length) {
                bloques.push({ tipo: "p", texto: parrafo.join(" ") });
                parrafo = [];
            }
        };

        const esFilaTabla = (l) => /^\s*\|.*\|\s*$/.test(l);
        const esSeparador = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

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
                bloques.push({ tipo: "codigo", texto: codigo.join("\n") });
                continue;
            }

            if (esFilaTabla(linea) && i + 1 < lineas.length && esSeparador(lineas[i + 1])) {
                cerrarParrafo();
                const filas = [];
                const partir = (l) =>
                    l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
                filas.push(partir(linea));
                i += 2;
                while (i < lineas.length && esFilaTabla(lineas[i])) {
                    filas.push(partir(lineas[i]));
                    i++;
                }
                bloques.push({ tipo: "tabla", filas });
                continue;
            }

            const titulo = linea.match(/^(#{1,3})\s+(.*)$/);
            if (titulo) {
                cerrarParrafo();
                bloques.push({ tipo: "h", nivel: titulo[1].length, texto: titulo[2].trim() });
                i++;
                continue;
            }

            if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(linea)) {
                cerrarParrafo();
                bloques.push({ tipo: "hr" });
                i++;
                continue;
            }

            const viñeta = linea.match(/^\s*[-*+]\s+(.*)$/);
            if (viñeta) {
                cerrarParrafo();
                bloques.push({ tipo: "li", ordenado: false, texto: viñeta[1] });
                i++;
                continue;
            }

            const numerada = linea.match(/^\s*(\d+)[.)]\s+(.*)$/);
            if (numerada) {
                cerrarParrafo();
                bloques.push({ tipo: "li", ordenado: true, numero: numerada[1], texto: numerada[2] });
                i++;
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
        return bloques;
    }

    // Divide un texto en tramos con formato: **negrita**, *cursiva*, `código`.
    function tramosInline(texto) {
        const tramos = [];
        const patron = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
        let ultimo = 0;
        let m;

        while ((m = patron.exec(texto)) !== null) {
            if (m.index > ultimo) tramos.push({ texto: texto.slice(ultimo, m.index) });

            const t = m[0];
            if (t.startsWith("**")) tramos.push({ texto: t.slice(2, -2), negrita: true });
            else if (t.startsWith("`")) tramos.push({ texto: t.slice(1, -1), codigo: true });
            else tramos.push({ texto: t.slice(1, -1), cursiva: true });

            ultimo = m.index + t.length;
        }

        if (ultimo < texto.length) tramos.push({ texto: texto.slice(ultimo) });
        return tramos;
    }

    function textoPlano(texto) {
        return tramosInline(texto).map((t) => t.texto).join("");
    }

    // ----------------------------------------
    // DOCX (se arma a mano, es un zip de XML)
    // ----------------------------------------

    function esc(texto) {
        return String(texto)
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function xmlTramos(texto, base = {}) {
        return tramosInline(texto).map((t) => {
            const props = [];
            if (base.negrita || t.negrita) props.push("<w:b/>");
            if (base.cursiva || t.cursiva) props.push("<w:i/>");
            if (t.codigo) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/>');
            const rpr = props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";
            return `<w:r>${rpr}<w:t xml:space="preserve">${esc(t.texto)}</w:t></w:r>`;
        }).join("");
    }

    function xmlParrafo(contenido, ppr = "") {
        return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${contenido}</w:p>`;
    }

    function xmlBloque(b) {
        switch (b.tipo) {
            case "h":
                return xmlParrafo(xmlTramos(b.texto), `<w:pStyle w:val="Heading${b.nivel}"/>`);

            case "p":
                return xmlParrafo(xmlTramos(b.texto), '<w:spacing w:after="140"/>');

            case "li": {
                const marca = b.ordenado ? `${b.numero}.` : "•";
                return xmlParrafo(
                    `<w:r><w:t xml:space="preserve">${esc(marca)}\u00A0\u00A0</w:t></w:r>` + xmlTramos(b.texto),
                    '<w:spacing w:after="60"/><w:ind w:left="720" w:hanging="360"/>'
                );
            }

            case "codigo":
                return b.texto.split("\n").map((linea) =>
                    xmlParrafo(
                        `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr><w:t xml:space="preserve">${esc(linea) || " "}</w:t></w:r>`,
                        '<w:shd w:val="clear" w:color="auto" w:fill="F1EEFB"/><w:spacing w:after="0"/>'
                    )
                ).join("") + xmlParrafo("");

            case "hr":
                return xmlParrafo("", '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr>');

            case "tabla": {
                const columnas = Math.max(...b.filas.map((f) => f.length));
                const ancho = Math.floor(9000 / columnas);
                const rejilla = Array.from({ length: columnas }, () => `<w:gridCol w:w="${ancho}"/>`).join("");

                const filas = b.filas.map((fila, indice) => {
                    const celdas = Array.from({ length: columnas }, (_, c) => {
                        const textoCelda = fila[c] !== undefined ? fila[c] : "";
                        return `<w:tc><w:tcPr><w:tcW w:w="${ancho}" w:type="dxa"/></w:tcPr>` +
                            xmlParrafo(xmlTramos(textoCelda, { negrita: indice === 0 })) +
                            `</w:tc>`;
                    }).join("");
                    return `<w:tr>${celdas}</w:tr>`;
                }).join("");

                return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${rejilla}</w:tblGrid>${filas}</w:tbl>` + xmlParrafo("");
            }

            default:
                return "";
        }
    }

    const DOCX_TIPOS =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>';

    const DOCX_REL_RAIZ =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>';

    const DOCX_REL_DOC =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>';

    const DOCX_ESTILOS =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="es-ES"/></w:rPr></w:rPrDefault>' +
        '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="260" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>' +
        '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>' +
        '<w:top w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:left w:val="single" w:sz="4" w:space="0" w:color="999999"/>' +
        '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:right w:val="single" w:sz="4" w:space="0" w:color="999999"/>' +
        '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="999999"/>' +
        '</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
        '</w:styles>';

    async function construirDocx(spec) {
        const JSZip = await cargarLibreria("jszip");
        const bloques = parsearMarkdown(spec.contenido);

        const cuerpo = bloques.map(xmlBloque).join("") || xmlParrafo("");

        const documento =
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
            `<w:body>${cuerpo}` +
            '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
            '</w:body></w:document>';

        const zip = new JSZip();
        zip.file("[Content_Types].xml", DOCX_TIPOS);
        zip.file("_rels/.rels", DOCX_REL_RAIZ);
        zip.file("word/document.xml", documento);
        zip.file("word/styles.xml", DOCX_ESTILOS);
        zip.file("word/_rels/document.xml.rels", DOCX_REL_DOC);

        return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    }

    // ----------------------------------------
    // XLSX
    // ----------------------------------------

    function nombreDeHoja(nombre, usados) {
        let limpio = String(nombre || "Hoja")
            .replace(/[\[\]:*?\/\\]/g, " ")
            .trim()
            .slice(0, 31) || "Hoja";

        let candidato = limpio;
        let n = 2;

        while (usados.has(candidato.toLowerCase())) {
            const sufijo = ` ${n++}`;
            candidato = limpio.slice(0, 31 - sufijo.length) + sufijo;
        }

        usados.add(candidato.toLowerCase());
        return candidato;
    }

    async function construirXlsx(spec) {
        const XLSX = await cargarLibreria("xlsx");
        const libro = XLSX.utils.book_new();
        const usados = new Set();

        const hojas = spec.hojas.length ? spec.hojas : [{ nombre: "Hoja1", filas: [[]] }];

        for (const hoja of hojas) {
            const filas = (Array.isArray(hoja.filas) ? hoja.filas : []).map((fila) =>
                (Array.isArray(fila) ? fila : [fila]).map((celda) =>
                    celda === null || celda === undefined ? "" : celda
                )
            );

            const ws = XLSX.utils.aoa_to_sheet(filas.length ? filas : [[]]);

            const columnas = Math.max(0, ...filas.map((f) => f.length));
            ws["!cols"] = Array.from({ length: columnas }, (_, c) => ({
                wch: Math.min(
                    60,
                    Math.max(8, ...filas.map((f) => String(f[c] ?? "").length + 2))
                )
            }));

            XLSX.utils.book_append_sheet(libro, ws, nombreDeHoja(hoja.nombre, usados));
        }

        return XLSX.write(libro, { type: "array", bookType: "xlsx" });
    }

    // ----------------------------------------
    // PDF
    // ----------------------------------------

    function paraPdf(texto) {
        return String(texto)
            .replace(/[\u201C\u201D\u201E]/g, '"')
            .replace(/[\u2018\u2019\u201A]/g, "'")
            .replace(/[\u2013\u2014]/g, "-")
            .replace(/\u2026/g, "...")
            .replace(/[\u2022\u25CF\u25AA]/g, "-")
            .replace(/\u20AC/g, "EUR")
            .replace(/\u00A0/g, " ")
            .replace(/[^\u0009\u000A\u0020-\u00FF]/g, "?");
    }

    async function construirPdf(spec) {
        const { jsPDF } = await cargarLibreria("jspdf");
        const doc = new jsPDF({ unit: "pt", format: "a4" });

        const margen = 56;
        const anchoPagina = doc.internal.pageSize.getWidth();
        const altoPagina = doc.internal.pageSize.getHeight();
        const ancho = anchoPagina - margen * 2;
        let y = margen;

        const asegurar = (alto) => {
            if (y + alto > altoPagina - margen) {
                doc.addPage();
                y = margen;
            }
        };

        const escribir = (texto, { x = margen, tam = 11, estilo = "normal", fuente = "helvetica", espacioLinea = 1.35, ancho: w = ancho, despues = 6 } = {}) => {
            doc.setFont(fuente, estilo);
            doc.setFontSize(tam);
            const lineas = doc.splitTextToSize(paraPdf(texto), w);
            const alto = tam * espacioLinea;

            for (const linea of lineas) {
                asegurar(alto);
                doc.text(linea, x, y + tam);
                y += alto;
            }
            y += despues;
        };

        for (const b of parsearMarkdown(spec.contenido)) {
            if (b.tipo === "h") {
                const tam = [0, 20, 16, 13][b.nivel];
                y += b.nivel === 1 ? 6 : 4;
                escribir(textoPlano(b.texto), { tam, estilo: "bold", despues: 6 });
            } else if (b.tipo === "p") {
                escribir(textoPlano(b.texto));
            } else if (b.tipo === "li") {
                const marca = b.ordenado ? `${b.numero}.` : "-";
                asegurar(16);
                doc.setFont("helvetica", "normal");
                doc.setFontSize(11);
                doc.text(marca, margen + 6, y + 11);
                escribir(textoPlano(b.texto), { x: margen + 24, ancho: ancho - 24, despues: 3 });
            } else if (b.tipo === "codigo") {
                doc.setFont("courier", "normal");
                doc.setFontSize(9);
                const lineas = doc.splitTextToSize(paraPdf(b.texto), ancho - 16);
                for (const linea of lineas) {
                    asegurar(13);
                    doc.setFillColor(241, 238, 251);
                    doc.rect(margen, y, ancho, 13, "F");
                    doc.text(linea, margen + 8, y + 10);
                    y += 13;
                }
                y += 8;
            } else if (b.tipo === "hr") {
                asegurar(12);
                doc.setDrawColor(150);
                doc.line(margen, y + 4, margen + ancho, y + 4);
                y += 14;
            } else if (b.tipo === "tabla") {
                const columnas = Math.max(...b.filas.map((f) => f.length));
                const anchoCol = ancho / columnas;

                b.filas.forEach((fila, indice) => {
                    doc.setFont("helvetica", indice === 0 ? "bold" : "normal");
                    doc.setFontSize(10);

                    const celdas = Array.from({ length: columnas }, (_, c) =>
                        doc.splitTextToSize(paraPdf(textoPlano(fila[c] || "")), anchoCol - 10)
                    );
                    const lineasMax = Math.max(...celdas.map((c) => c.length));
                    const alto = lineasMax * 13 + 8;

                    asegurar(alto);
                    celdas.forEach((lineas, c) => {
                        doc.rect(margen + c * anchoCol, y, anchoCol, alto);
                        lineas.forEach((linea, l) => {
                            doc.text(linea, margen + c * anchoCol + 5, y + 14 + l * 13);
                        });
                    });
                    y += alto;
                });
                y += 8;
            }
        }

        return doc.output("arraybuffer");
    }

    // ----------------------------------------
    // PPTX
    // ----------------------------------------

    async function construirPptx(spec) {
        const PptxGenJS = await cargarLibreria("pptx");
        const pptx = new PptxGenJS();
        pptx.layout = "LAYOUT_WIDE";

        const diapositivas = spec.diapositivas.length
            ? spec.diapositivas
            : [{ titulo: "Presentación", puntos: [] }];

        for (const d of diapositivas) {
            const slide = pptx.addSlide();

            slide.addText(String(d.titulo || ""), {
                x: 0.6, y: 0.4, w: 12.1, h: 1.1,
                fontSize: 32, bold: true, color: "14121F", fontFace: "Calibri"
            });

            const puntos = (Array.isArray(d.puntos) ? d.puntos : []).map((p) => ({
                text: String(p),
                options: { bullet: true, breakLine: true }
            }));

            if (puntos.length) {
                slide.addText(puntos, {
                    x: 0.8, y: 1.7, w: 11.7, h: 5,
                    fontSize: 22, color: "3F3B54", fontFace: "Calibri", valign: "top",
                    paraSpaceAfter: 10
                });
            }
        }

        return pptx.write({ outputType: "arraybuffer" });
    }

    // ----------------------------------------
    // API pública
    // ----------------------------------------

    async function generar(specCruda) {
        const spec = normalizarSpec(specCruda);
        const nombre = nombreFinal(specCruda);
        const extension = extensionDe(nombre);
        const mime = MIME_POR_EXTENSION[extension] || "text/plain;charset=utf-8";

        let datos;

        if (spec.tipo === "docx") datos = await construirDocx(spec);
        else if (spec.tipo === "xlsx") datos = await construirXlsx(spec);
        else if (spec.tipo === "pdf") datos = await construirPdf(spec);
        else if (spec.tipo === "pptx") datos = await construirPptx(spec);
        else {
            // Texto plano. El CSV lleva marca BOM para que Excel respete los acentos.
            datos = extension === "csv" ? "\uFEFF" + spec.contenido : spec.contenido;
        }

        return { blob: new Blob([datos], { type: mime }), nombre, mime };
    }

    async function descargar(spec) {
        const { blob, nombre } = await generar(spec);

        const enlace = document.createElement("a");
        enlace.href = URL.createObjectURL(blob);
        enlace.download = nombre;
        document.body.appendChild(enlace);
        enlace.click();
        enlace.remove();

        setTimeout(() => URL.revokeObjectURL(enlace.href), 10000);
    }

    // Extrae los bloques ```leda-archivo``` de un mensaje.
    // Devuelve el texto sin los bloques y la lista de archivos.
    function separarArchivos(texto, { enCurso = false } = {}) {
        const archivos = [];
        const patron = /```leda-archivo\s*([\s\S]*?)```/g;

        let limpio = String(texto || "").replace(patron, (_, json) => {
            try {
                const spec = JSON.parse(json.trim());
                if (spec && typeof spec.tipo === "string" && typeof spec.nombre === "string") {
                    archivos.push(spec);
                }
            } catch (e) { /* bloque inválido: se oculta igual */ }
            return "";
        });

        // Mientras llega la respuesta, un bloque a medio escribir no se muestra.
        let creando = false;
        const inicio = limpio.indexOf("```leda-archivo");
        if (inicio !== -1) {
            limpio = limpio.slice(0, inicio);
            creando = enCurso;
        }

        return { texto: limpio.trim(), archivos, creando };
    }

    const API = {
        generar,
        descargar,
        nombreFinal,
        normalizarSpec,
        parsearMarkdown,
        tramosInline,
        separarArchivos
    };

    global.LedaArchivos = API;

    if (typeof module !== "undefined" && module.exports) {
        module.exports = API;
    }

})(typeof window !== "undefined" ? window : globalThis);
