/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import {
  FileText,
  Upload,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// 1 cm in PDF points (72 pt = 1 inch, 1 inch = 2.54 cm)
const CM_TO_PT = 72 / 2.54; // ≈ 28.35
const PDF_SCALE = 1.5; // canvas render scale

interface TextMark {
  pageIndex: number;
  itemIndex: number;
  originalText: string;
  newText: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  width: number;
  height: number;
  transform: number[];
}

// Free-floating text mark (header, footer, etc.) — draggable & editable
interface CustomMark {
  id: string;
  pageIndex: number; // -1 = todas las páginas
  text: string;
  x: number;          // PDF user space (origen abajo-izquierda)
  y: number;          // PDF user space (baseline)
  fontSize: number;   // tamaño en puntos PDF
}

type ReportType = 'zeiss' | 'engranaje';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [edits, setEdits] = useState<TextMark[]>([]);
  const [customMarks, setCustomMarks] = useState<CustomMark[]>([]);
  const [activeEdit, setActiveEdit] = useState<{ page: number; item: number } | null>(null);
  const [activeItemData, setActiveItemData] = useState<any | null>(null);
  const [activeCustomMark, setActiveCustomMark] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [reportType, setReportType] = useState<ReportType | null>(null);

  const zeissInputRef = useRef<HTMLInputElement>(null);
  const gearInputRef = useRef<HTMLInputElement>(null);
  const pendingTypeRef = useRef<ReportType | null>(null);

  const triggerUpload = (type: ReportType) => {
    pendingTypeRef.current = type;
    if (type === 'zeiss') zeissInputRef.current?.click();
    else gearInputRef.current?.click();
  };

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    const type = pendingTypeRef.current;
    // Reset input value so volver a subir el mismo archivo dispare onChange
    event.target.value = '';
    if (!selectedFile || selectedFile.type !== 'application/pdf' || !type) return;

    const resolucion = window.prompt('Ingrese Resolucion:', '');
    if (resolucion === null) return;
    const firma = window.prompt('Ingrese Firma:', '');
    if (firma === null) return;

    loadPdf(selectedFile, type, resolucion.trim(), firma.trim());
  };

  const fileBaseName = (name: string) =>
    name.replace(/\.pdf$/i, '');

  const buildGearMarks = async (
    doc: pdfjsLib.PDFDocumentProxy,
    informeNum: string,
    resolucion: string,
    firma: string,
  ): Promise<CustomMark[]> => {
    // Tomamos las dimensiones de la primera página para definir posiciones por defecto.
    const firstPage = await doc.getPage(1);
    const vp = firstPage.getViewport({ scale: 1 }); // 1 = puntos PDF
    const pageHeightPt = vp.height;

    const headerFontSize = 11;
    const footerFontSize = 9;
    const leftMarginPt = CM_TO_PT * 2; // 2cm margen izquierdo

    const headerText =
      `Informe: ${informeNum}                           ` +
      `Resolucion: ${resolucion}                         ` +
      `Firma: ${firma}`;

    const footerText =
      `Fecha del informe - Aseguramiento de la Calidad - CC : 8400 - KSU: 7.2 - Clasificacion : Interno`;

    // Header: baseline a 1cm del tope (descendiendo desde el borde superior)
    const headerY = pageHeightPt - CM_TO_PT - headerFontSize * 0.8;
    // Footer: baseline a 1cm del borde inferior
    const footerY = CM_TO_PT;

    return [
      {
        id: 'gear-header',
        pageIndex: -1,
        text: headerText,
        x: leftMarginPt,
        y: headerY,
        fontSize: headerFontSize,
      },
      {
        id: 'gear-footer',
        pageIndex: -1,
        text: footerText,
        x: leftMarginPt,
        y: footerY,
        fontSize: footerFontSize,
      },
    ];
  };

  const autoFillZeissEdits = async (
    doc: pdfjsLib.PDFDocumentProxy,
    informeNum: string,
    resolucion: string,
    firma: string,
  ): Promise<TextMark[]> => {
    const newEdits: TextMark[] = [];

    const replacements: { re: RegExp; value: string }[] = [
      { re: /^(\s*Informe\s*No\.?\s*:\s*)\.+\s*$/i, value: informeNum },
      { re: /^(\s*Informes?\s*No\.?\s*:\s*)\.+\s*$/i, value: informeNum },
      { re: /^(\s*Informe\s*:\s*)\.+\s*$/i, value: informeNum },
      { re: /^(\s*Resoluci[oó]n\s*:\s*)\.+\s*$/i, value: resolucion },
      { re: /^(\s*Firma\s*\/\s*Leg\.?\s*:\s*)\.+\s*$/i, value: firma },
      { re: /^(\s*Firma\s*:\s*)\.+\s*$/i, value: firma },
    ];

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      content.items.forEach((item: any, idx: number) => {
        if (!item.str) return;
        for (const { re, value } of replacements) {
          const m = item.str.match(re);
          if (m) {
            const transform = item.transform;
            const fontSize = Math.abs(transform[3]);
            newEdits.push({
              pageIndex: p - 1,
              itemIndex: idx,
              originalText: item.str,
              newText: `${m[1]}${value}`,
              x: transform[4],
              y: transform[5],
              fontSize,
              fontFamily: item.fontName,
              width: item.width,
              height: fontSize,
              transform: [...transform],
            });
            return;
          }
        }
      });
    }
    return newEdits;
  };

  const loadPdf = async (
    file: File,
    type: ReportType,
    resolucion: string,
    firma: string,
  ) => {
    setIsLoading(true);
    setEdits([]);
    setCustomMarks([]);
    setReportType(type);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const doc = await loadingTask.promise;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
      setFile(file);
      setCurrentPage(1);

      const informeNum = fileBaseName(file.name);

      if (type === 'engranaje') {
        const marks = await buildGearMarks(doc, informeNum, resolucion, firma);
        setCustomMarks(marks);
      } else {
        const autoEdits = await autoFillZeissEdits(doc, informeNum, resolucion, firma);
        setEdits(autoEdits);
      }
    } catch (error) {
      console.error('Error loading PDF:', error);
      alert('Error cargando el PDF. Intente de nuevo.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (pageIndex: number, itemIndex: number, originalItem: any, newText: string) => {
    setEdits(prev => {
      const filtered = prev.filter(e => !(e.pageIndex === pageIndex && e.itemIndex === itemIndex));
      if (newText === originalItem.str) return filtered;

      const transform = originalItem.transform;
      const fontSize = Math.abs(transform[3]);

      return [...filtered, {
        pageIndex,
        itemIndex,
        originalText: originalItem.str,
        newText,
        x: transform[4],
        y: transform[5],
        fontSize: fontSize,
        fontFamily: originalItem.fontName,
        width: originalItem.width,
        height: fontSize,
        transform: [...transform]
      }];
    });
    setActiveEdit(null);
    setActiveItemData(null);
  };

  const updateCustomMark = (id: string, patch: Partial<CustomMark>) => {
    setCustomMarks(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)));
  };

  const downloadEditedPdf = async () => {
    if (!file) return;
    if (edits.length === 0 && customMarks.length === 0) return;
    setIsExporting(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDocOut = await PDFDocument.load(arrayBuffer);
      const font = await pdfDocOut.embedFont(StandardFonts.Helvetica);
      const pages = pdfDocOut.getPages();

      // Ediciones sobre texto existente
      for (const edit of edits) {
        const page = pages[edit.pageIndex];
        page.drawRectangle({
          x: edit.x,
          y: edit.y - (edit.fontSize * 0.15),
          width: edit.width,
          height: edit.fontSize * 1.2,
          color: rgb(1, 1, 1),
        });
        page.drawText(edit.newText, {
          x: edit.x,
          y: edit.y,
          size: edit.fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      }

      // Marcas libres (encabezado/pie)
      for (const mark of customMarks) {
        const targetPages = mark.pageIndex === -1
          ? pages
          : [pages[mark.pageIndex]];
        for (const p of targetPages) {
          p.drawText(mark.text, {
            x: mark.x,
            y: mark.y,
            size: mark.fontSize,
            font,
            color: rgb(0, 0, 0),
          });
        }
      }

      const pdfBytes = await pdfDocOut.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `editado_${file.name}`;
      link.click();
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Error exportando el PDF. Asegúrate de que el archivo no esté protegido.');
    } finally {
      setIsExporting(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPdfDoc(null);
    setEdits([]);
    setCustomMarks([]);
    setCurrentPage(1);
    setActiveItemData(null);
    setActiveCustomMark(null);
    setReportType(null);
  };

  return (
    <div className="h-screen flex flex-col bg-paper overflow-hidden">
      {/* Editorial Header */}
      <header className="h-14 bg-white border-b border-neutral-200 flex items-center justify-between px-6 flex-shrink-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-black rounded flex flex-col items-center justify-center gap-0.5">
            <div className="w-4 h-0.5 bg-white"></div>
            <div className="w-4 h-0.5 bg-white"></div>
          </div>
          <div>
            <h1 className="font-bold text-xs uppercase tracking-[0.2em]">TypeFlow Editor v2.4</h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {file && (
            <>
              <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                Modo: {reportType === 'engranaje' ? 'Engranaje' : 'Zeiss'}
              </span>
              <button
                onClick={reset}
                className="btn-editorial border border-neutral-300 rounded hover:bg-neutral-50 px-4"
                id="btn-reset"
              >
                Reiniciar
              </button>
              <button
                onClick={downloadEditedPdf}
                disabled={isExporting}
                className="btn-editorial bg-black text-white rounded hover:bg-neutral-800 px-6"
                id="btn-export"
              >
                {isExporting ? <Loader2 size={12} className="animate-spin" /> : 'Guardar PDF'}
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Layout Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="sidebar p-5 shrink-0">
          <div className="mb-10">
            <label className="label-caps">Herramientas</label>
            <div className="space-y-1">
              <div className="flex items-center space-x-3 p-2 bg-neutral-100 rounded cursor-pointer group">
                <FileText size={14} className="text-neutral-900" />
                <span className="text-xs font-medium">Editor de Texto</span>
              </div>
            </div>
          </div>

          {!file ? (
            <div className="mt-auto space-y-3">
              <label className="label-caps">Cargar Informe</label>

              <button
                onClick={() => triggerUpload('zeiss')}
                className="w-full py-4 border-2 border-dashed border-neutral-200 rounded-xl flex flex-col items-center justify-center hover:border-neutral-400 hover:bg-neutral-50 transition-all gap-2"
              >
                <div className="w-8 h-8 bg-neutral-100 rounded-full flex items-center justify-center text-neutral-400">
                  <Upload size={16} />
                </div>
                <span className="text-[10px] uppercase font-bold text-neutral-600 tracking-wider text-center px-2">
                  Subir Informe Zeiss
                </span>
              </button>

              <button
                onClick={() => triggerUpload('engranaje')}
                className="w-full py-4 border-2 border-dashed border-neutral-200 rounded-xl flex flex-col items-center justify-center hover:border-neutral-400 hover:bg-neutral-50 transition-all gap-2"
              >
                <div className="w-8 h-8 bg-neutral-100 rounded-full flex items-center justify-center text-neutral-400">
                  <Upload size={16} />
                </div>
                <span className="text-[10px] uppercase font-bold text-neutral-600 tracking-wider text-center px-2">
                  Subir Informe Engranaje
                </span>
              </button>

              <input
                type="file"
                ref={zeissInputRef}
                onChange={onFileChange}
                accept=".pdf"
                className="hidden"
              />
              <input
                type="file"
                ref={gearInputRef}
                onChange={onFileChange}
                accept=".pdf"
                className="hidden"
              />
            </div>
          ) : (
            <div className="mt-8">
              <label className="label-caps">Navegación</label>
              <div className="flex items-center justify-between gap-2 bg-neutral-50 p-2 rounded border border-neutral-200">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage <= 1}
                  className="p-1 hover:bg-white disabled:opacity-20 rounded"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  {currentPage} / {numPages}
                </span>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(numPages, prev + 1))}
                  disabled={currentPage >= numPages}
                  className="p-1 hover:bg-white disabled:opacity-20 rounded"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </aside>

        {/* Central Workspace */}
        <section className="flex-1 overflow-auto bg-canvas relative">
          <div className="flex flex-col items-center p-6 lg:p-12 min-h-full">
            {file && (
              <div className="mb-6 w-full max-w-[1200px] text-[10px] font-mono uppercase tracking-[0.2em] text-neutral-400">
                Documento: <span className="text-neutral-600">{file.name}</span>
              </div>
            )}

            {!file ? (
              <div className="flex-1 flex items-center justify-center text-neutral-400 font-mono text-xs uppercase tracking-widest min-h-[400px]">
                Esperando archivo...
              </div>
            ) : (
              <PDFPage
                key={`${file.name}-${currentPage}`}
                pdfDoc={pdfDoc!}
                pageNumber={currentPage}
                edits={edits.filter(e => e.pageIndex === currentPage - 1)}
                activeEdit={activeEdit?.page === currentPage - 1 ? activeEdit.item : null}
                customMarks={customMarks.filter(
                  m => m.pageIndex === -1 || m.pageIndex === currentPage - 1,
                )}
                activeCustomMark={activeCustomMark}
                onSetActive={(itemIndex, item) => {
                  setActiveEdit({ page: currentPage - 1, item: itemIndex });
                  setActiveItemData(item);
                  setActiveCustomMark(null);
                }}
                onUpdateItem={(index, item, text) => handleEdit(currentPage - 1, index, item, text)}
                onSelectCustomMark={id => {
                  setActiveCustomMark(id);
                  setActiveEdit(null);
                  setActiveItemData(null);
                }}
                onUpdateCustomMark={updateCustomMark}
              />
            )}
          </div>
        </section>

        {/* Inspector Sidebar */}
        <aside className="inspector p-5 shrink-0">
          <label className="label-caps">Inspector</label>

          <AnimatePresence mode="wait">
            {activeItemData ? (
              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-6"
              >
                <div>
                  <span className="text-[10px] text-neutral-400 uppercase font-bold block mb-2">Familia</span>
                  <div className="bg-neutral-100 p-2 rounded text-xs font-mono truncate">
                    {activeItemData.fontName || 'Predeterminado'}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] text-neutral-400 uppercase font-bold block mb-2">Tamaño</span>
                    <div className="bg-neutral-100 p-2 rounded text-xs font-mono">
                      {Math.round(Math.sqrt(activeItemData.transform[0] ** 2 + activeItemData.transform[1] ** 2))}px
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-neutral-400 uppercase font-bold block mb-2">Ancho</span>
                    <div className="bg-neutral-100 p-2 rounded text-xs font-mono">
                      {Math.round(activeItemData.width)}px
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : activeCustomMark ? (
              <div className="space-y-3">
                <p className="text-[10px] text-neutral-500 leading-relaxed">
                  Bloque libre seleccionado. Doble click para editar el texto. Arrastrá para mover.
                </p>
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center border-2 border-dashed border-neutral-100 rounded-lg">
                <p className="text-[9px] text-neutral-300 uppercase font-bold tracking-widest text-center px-4">
                  Selecciona un texto para ver sus propiedades
                </p>
              </div>
            )}
          </AnimatePresence>
        </aside>
      </div>

      {isLoading && (
        <div className="fixed inset-0 bg-white/60 backdrop-blur-sm z-[100] flex flex-col items-center justify-center gap-4 text-black">
          <Loader2 size={32} className="animate-spin" />
          <p className="text-[10px] font-bold uppercase tracking-[0.3em]">Cargando Manuscrito</p>
        </div>
      )}
    </div>
  );
}

interface PDFPageProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  edits: TextMark[];
  activeEdit: number | null;
  customMarks: CustomMark[];
  activeCustomMark: string | null;
  onSetActive: (itemIndex: number, item: any) => void;
  onUpdateItem: (index: number, originalItem: any, text: string) => void;
  onSelectCustomMark: (id: string) => void;
  onUpdateCustomMark: (id: string, patch: Partial<CustomMark>) => void;
}

function PDFPage({
  pdfDoc,
  pageNumber,
  edits,
  activeEdit,
  customMarks,
  activeCustomMark,
  onSetActive,
  onUpdateItem,
  onSelectCustomMark,
  onUpdateCustomMark,
}: PDFPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<any>(null);
  const [textItems, setTextItems] = useState<any[]>([]);
  const [viewport, setViewport] = useState<pdfjsLib.PageViewport | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isRendering, setIsRendering] = useState(true);
  const [pageHeightPt, setPageHeightPt] = useState(0);
  const [editingMarkId, setEditingMarkId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const renderPage = async () => {
      if (renderTaskRef.current) {
        try {
          await renderTaskRef.current.cancel();
        } catch (e) {}
      }

      setIsRendering(true);
      try {
        const page = await pdfDoc.getPage(pageNumber);
        const vp = page.getViewport({ scale: PDF_SCALE });

        if (!isMounted) return;

        setViewport(vp);
        setPageHeightPt(vp.height / PDF_SCALE);
        setDimensions({ width: vp.width, height: vp.height });

        if (canvasRef.current) {
          const canvas = canvasRef.current;
          const context = canvas.getContext('2d');
          canvas.width = vp.width;
          canvas.height = vp.height;

          const renderContext = { canvasContext: context!, viewport: vp };
          const task = page.render(renderContext);
          renderTaskRef.current = task;
          await task.promise;

          if (!isMounted) return;

          const content = await page.getTextContent();
          setTextItems(content.items);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'RenderingCancelledException') return;
        console.error('Render error:', err);
      } finally {
        if (isMounted) setIsRendering(false);
      }
    };

    renderPage();

    return () => {
      isMounted = false;
      if (renderTaskRef.current) renderTaskRef.current.cancel();
    };
  }, [pdfDoc, pageNumber]);

  // PDF (puntos, origen abajo-izquierda) → pantalla (px, origen arriba-izquierda)
  const pdfToScreen = (xPt: number, yPt: number) => ({
    x: xPt * PDF_SCALE,
    y: (pageHeightPt - yPt) * PDF_SCALE,
  });
  const screenDeltaToPdf = (dx: number, dy: number) => ({
    dx: dx / PDF_SCALE,
    dy: -dy / PDF_SCALE,
  });

  const startDrag = (e: React.MouseEvent, mark: CustomMark) => {
    if (editingMarkId === mark.id) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectCustomMark(mark.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = mark.x;
    const origY = mark.y;

    const onMove = (ev: MouseEvent) => {
      const { dx, dy } = screenDeltaToPdf(ev.clientX - startX, ev.clientY - startY);
      onUpdateCustomMark(mark.id, { x: origX + dx, y: origY + dy });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className="pdf-container mb-12 shadow-2xl"
      style={{ width: dimensions.width, height: dimensions.height }}
      ref={containerRef}
    >
      <canvas ref={canvasRef} className="block" />

      {!isRendering && viewport && (
        <div className="absolute inset-0 z-10 select-none overflow-hidden">
          {textItems.map((item: any, idx) => {
            if (!item.str.trim()) return null;

            const edit = edits.find(e => e.itemIndex === idx);
            const isEdited = !!edit;
            const displayText = edit ? edit.newText : item.str;

            const transform = item.transform;
            const fontSizePdf = Math.abs(transform[3]);

            const [vx, vy_baseline] = viewport.convertToViewportPoint(transform[4], transform[5]);
            const [, vy_top] = viewport.convertToViewportPoint(transform[4], transform[5] + fontSizePdf);

            const finalX = vx;
            const finalY = vy_top + 4;
            const fontSizePx = Math.abs(vy_baseline - vy_top);

            const isActive = activeEdit === idx;

            return (
              <div key={idx}>
                <div
                  className={cn('text-layer-item group', isEdited && 'is-edited')}
                  style={{
                    left: `${finalX}px`,
                    top: `${finalY}px`,
                    fontSize: `${fontSizePx}px`,
                    minWidth: `${item.width * viewport.scale}px` || 'auto',
                    height: `${fontSizePx}px`,
                    opacity: isActive ? 0 : 1,
                    zIndex: isEdited ? 30 : 20,
                  }}
                  onClick={e => {
                    e.stopPropagation();
                    onSetActive(idx, item);
                  }}
                >
                  {isEdited ? displayText : ''}
                </div>

                {isActive && (
                  <textarea
                    autoFocus
                    className="text-edit-input p-0"
                    defaultValue={displayText}
                    style={{
                      left: `${finalX}px`,
                      top: `${finalY}px`,
                      width: `${Math.max(item.width * viewport.scale, 160)}px`,
                      height: `${fontSizePx * 1.3}px`,
                      fontSize: `${fontSizePx}px`,
                      lineHeight: '1',
                    }}
                    onBlur={e => onUpdateItem(idx, item, e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        onUpdateItem(idx, item, (e.target as any).value);
                      }
                      if (e.key === 'Escape') onUpdateItem(idx, item, displayText);
                    }}
                  />
                )}
              </div>
            );
          })}

          {/* Custom marks (header / footer) */}
          {customMarks.map(mark => {
            const { x: sx, y: sy } = pdfToScreen(mark.x, mark.y);
            const fontSizePx = mark.fontSize * PDF_SCALE;
            const topPx = sy - fontSizePx; // baseline → top
            const isActive = activeCustomMark === mark.id;
            const isEditing = editingMarkId === mark.id;

            const commonStyle: React.CSSProperties = {
              left: `${sx}px`,
              top: `${topPx}px`,
              fontSize: `${fontSizePx}px`,
              lineHeight: '1',
              fontFamily: 'Arial, Helvetica, sans-serif',
              whiteSpace: 'pre',
            };

            if (isEditing) {
              return (
                <textarea
                  key={mark.id}
                  autoFocus
                  defaultValue={mark.text}
                  className="text-edit-input p-0"
                  style={{
                    ...commonStyle,
                    minWidth: '300px',
                    width: `${Math.max(mark.text.length * fontSizePx * 0.55, 300)}px`,
                    height: `${fontSizePx * 1.4}px`,
                  }}
                  onBlur={e => {
                    onUpdateCustomMark(mark.id, { text: e.target.value });
                    setEditingMarkId(null);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      onUpdateCustomMark(mark.id, { text: (e.target as any).value });
                      setEditingMarkId(null);
                    }
                    if (e.key === 'Escape') setEditingMarkId(null);
                  }}
                />
              );
            }

            return (
              <div
                key={mark.id}
                className={cn(
                  'absolute select-none px-0.5',
                  'cursor-move',
                  isActive ? 'ring-1 ring-blue-400 bg-blue-50/40' : 'hover:ring-1 hover:ring-neutral-300',
                )}
                style={{ ...commonStyle, zIndex: 40 }}
                onMouseDown={e => startDrag(e, mark)}
                onDoubleClick={e => {
                  e.stopPropagation();
                  onSelectCustomMark(mark.id);
                  setEditingMarkId(mark.id);
                }}
                title="Doble click para editar · Arrastrá para mover"
              >
                {mark.text}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
