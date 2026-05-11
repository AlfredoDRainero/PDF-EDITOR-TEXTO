/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import {
  FileText,
  Upload,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MousePointer2,
  Pen,
  Highlighter,
  Printer,
  Type,
  Eraser,
} from 'lucide-react';
import { cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const CM_TO_PT = 72 / 2.54;
const PDF_SCALE = 1.5;
const HIGHLIGHT_WIDTH_PT = 16;
const PEN_WIDTH_PT = 1.5;

const HIGHLIGHT_COLORS = [
  { name: 'Amarillo', value: '#FFFF00' },
  { name: 'Verde',    value: '#80FF00' },
  { name: 'Celeste',  value: '#80FFFF' },
  { name: 'Rosa',     value: '#FF80FF' },
];

const PEN_COLORS = [
  { name: 'Negro', value: '#000000' },
  { name: 'Rojo',  value: '#CC0000' },
  { name: 'Azul',  value: '#0000CC' },
  { name: 'Verde', value: '#006600' },
];

const TEXT_COLORS = [
  { name: 'Negro', value: '#000000' },
  { name: 'Rojo',  value: '#CC0000' },
  { name: 'Azul',  value: '#0000CC' },
  { name: 'Verde', value: '#006600' },
];

const TEXT_FONT_SIZES = [8, 10, 12, 14, 16, 20, 24];

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

interface CustomMark {
  id: string;
  pageIndex: number; // -1 = all pages
  text: string;
  x: number;       // PDF points
  y: number;       // PDF points (baseline)
  fontSize: number;
  color?: string;  // hex color, default black
}

interface DrawingStroke {
  id: string;
  pageIndex: number;
  tool: 'pen' | 'highlight';
  color: string;
  lineWidthPt: number;
  points: { x: number; y: number }[]; // in PDF points
}

type ReportType = 'zeiss' | 'engranaje' | 'comun';
type ActiveTool = 'select' | 'pen' | 'highlight' | 'text' | 'eraser';

const hexToRgb = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return rgb(r, g, b);
};

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [edits, setEdits] = useState<TextMark[]>([]);
  const [customMarks, setCustomMarks] = useState<CustomMark[]>([]);
  const [strokes, setStrokes] = useState<DrawingStroke[]>([]);
  const [activeEdit, setActiveEdit] = useState<{ page: number; item: number } | null>(null);
  const [activeItemData, setActiveItemData] = useState<any | null>(null);
  const [activeCustomMark, setActiveCustomMark] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [reportType, setReportType] = useState<ReportType | null>(null);
  const [activeTool, setActiveTool] = useState<ActiveTool>('select');
  const [penColor, setPenColor] = useState(PEN_COLORS[0].value);
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0].value);
  const [textColor, setTextColor] = useState(TEXT_COLORS[0].value);
  const [textFontSize, setTextFontSize] = useState(12);

  const zeissInputRef  = useRef<HTMLInputElement>(null);
  const gearInputRef   = useRef<HTMLInputElement>(null);
  const comunInputRef  = useRef<HTMLInputElement>(null);
  const pendingTypeRef = useRef<ReportType | null>(null);

  const hasUnsavedChanges = () =>
    file !== null && (edits.length > 0 || customMarks.length > 0 || strokes.length > 0);

  const triggerUpload = (type: ReportType) => {
    if (file && hasUnsavedChanges()) {
      if (!window.confirm('Hay cambios sin guardar. ¿Desea abrir otro archivo igualmente?')) return;
    }
    pendingTypeRef.current = type;
    if (type === 'zeiss')    zeissInputRef.current?.click();
    else if (type === 'engranaje') gearInputRef.current?.click();
    else                     comunInputRef.current?.click();
  };

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    const type = pendingTypeRef.current;
    event.target.value = '';
    if (!selectedFile || selectedFile.type !== 'application/pdf' || !type) return;

    if (type === 'comun') {
      loadPdf(selectedFile, 'comun', '', '');
      return;
    }

    const resolucion = window.prompt('Ingrese Resolucion:', '');
    if (resolucion === null) return;
    const firma = window.prompt('Ingrese Firma:', '');
    if (firma === null) return;

    loadPdf(selectedFile, type, resolucion.trim(), firma.trim());
  };

  const fileBaseName = (name: string) => name.replace(/\.pdf$/i, '');

  const buildGearMarks = async (
    doc: pdfjsLib.PDFDocumentProxy,
    informeNum: string,
    resolucion: string,
    firma: string,
  ): Promise<CustomMark[]> => {
    const firstPage = await doc.getPage(1);
    const vp = firstPage.getViewport({ scale: 1 });
    const pageHeightPt = vp.height;

    const headerFontSize = 11;
    const footerFontSize = 9;
    const leftMarginPt = CM_TO_PT * 2;

    const headerText =
      `Informe: ${informeNum}                           ` +
      `Resolucion: ${resolucion}                         ` +
      `Firma: ${firma}`;

    const footerText =
      `Fecha del informe - Aseguramiento de la Calidad - CC : 8400 - KSU: 7.2 - Clasificacion : Interno`;

    const headerY = pageHeightPt - CM_TO_PT - headerFontSize * 0.8;
    const footerY = CM_TO_PT;

    return [
      { id: 'gear-header', pageIndex: -1, text: headerText, x: leftMarginPt, y: headerY, fontSize: headerFontSize },
      { id: 'gear-footer', pageIndex: -1, text: footerText, x: leftMarginPt, y: footerY, fontSize: footerFontSize },
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
      { re: /^(\s*Informe\s*No\.?\s*:\s*)\.+\s*$/i,        value: informeNum },
      { re: /^(\s*Informes?\s*No\.?\s*:\s*)\.+\s*$/i,      value: informeNum },
      { re: /^(\s*Informe\s*:\s*)\.+\s*$/i,                value: informeNum },
      { re: /^(\s*Resoluci[oó]n\s*:\s*)\.+\s*$/i,          value: resolucion },
      { re: /^(\s*Firma\s*\/\s*Leg\.?\s*:\s*)\.+\s*$/i,    value: firma },
      { re: /^(\s*Firma\s*:\s*)\.+\s*$/i,                  value: firma },
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
              x: transform[4], y: transform[5],
              fontSize, fontFamily: item.fontName,
              width: item.width, height: fontSize,
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
    selectedFile: File,
    type: ReportType,
    resolucion: string,
    firma: string,
  ) => {
    setIsLoading(true);
    setEdits([]);
    setCustomMarks([]);
    setStrokes([]);
    setReportType(type);
    setActiveTool('select');
    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const doc = await loadingTask.promise;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
      setFile(selectedFile);
      setCurrentPage(1);

      const informeNum = fileBaseName(selectedFile.name);
      if (type === 'engranaje') {
        const marks = await buildGearMarks(doc, informeNum, resolucion, firma);
        setCustomMarks(marks);
      } else if (type === 'zeiss') {
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
        pageIndex, itemIndex,
        originalText: originalItem.str, newText,
        x: transform[4], y: transform[5],
        fontSize, fontFamily: originalItem.fontName,
        width: originalItem.width, height: fontSize,
        transform: [...transform],
      }];
    });
    setActiveEdit(null);
    setActiveItemData(null);
  };

  const updateCustomMark = (id: string, patch: Partial<CustomMark>) => {
    setCustomMarks(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)));
  };

  const addStroke = (stroke: DrawingStroke) => {
    setStrokes(prev => [...prev, stroke]);
  };

  const downloadEditedPdf = async () => {
    if (!file) return;
    setIsExporting(true);
    try {
      const pdfBytes = await buildModifiedPdfBytes();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `editado_${file.name}`;
      link.click();
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Error exportando el PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  const buildModifiedPdfBytes = async (): Promise<Uint8Array> => {
    const arrayBuffer = await file!.arrayBuffer();
    const pdfDocOut = await PDFDocument.load(arrayBuffer);
    const font = await pdfDocOut.embedFont(StandardFonts.Helvetica);
    const pages = pdfDocOut.getPages();

    for (const stroke of strokes.filter(s => s.tool === 'highlight')) {
      const page = pages[stroke.pageIndex];
      if (!page) continue;
      for (let i = 1; i < stroke.points.length; i++) {
        const p0 = stroke.points[i - 1];
        const p1 = stroke.points[i];
        page.drawLine({ start: { x: p0.x, y: p0.y }, end: { x: p1.x, y: p1.y }, thickness: stroke.lineWidthPt, color: hexToRgb(stroke.color), opacity: 0.4 });
      }
    }

    for (const edit of edits) {
      const page = pages[edit.pageIndex];
      page.drawRectangle({ x: edit.x, y: edit.y - edit.fontSize * 0.15, width: edit.width, height: edit.fontSize * 1.2, color: rgb(1, 1, 1) });
      page.drawText(edit.newText, { x: edit.x, y: edit.y, size: edit.fontSize, font, color: rgb(0, 0, 0) });
    }

    for (const mark of customMarks) {
      const markColor = mark.color ? hexToRgb(mark.color) : rgb(0, 0, 0);
      const targetPages = mark.pageIndex === -1 ? pages : [pages[mark.pageIndex]];
      for (const p of targetPages) {
        p.drawText(mark.text, { x: mark.x, y: mark.y, size: mark.fontSize, font, color: markColor });
      }
    }

    for (const stroke of strokes.filter(s => s.tool === 'pen')) {
      const page = pages[stroke.pageIndex];
      if (!page) continue;
      for (let i = 1; i < stroke.points.length; i++) {
        const p0 = stroke.points[i - 1];
        const p1 = stroke.points[i];
        page.drawLine({ start: { x: p0.x, y: p0.y }, end: { x: p1.x, y: p1.y }, thickness: stroke.lineWidthPt, color: hexToRgb(stroke.color) });
      }
    }

    return pdfDocOut.save();
  };

  const handlePrint = async () => {
    if (!file) return;
    const pdfBytes = await buildModifiedPdfBytes();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) win.addEventListener('load', () => win.print());
  };

  const reset = () => {
    if (hasUnsavedChanges()) {
      if (!window.confirm('Hay cambios sin guardar. ¿Desea reiniciar de todas formas?')) return;
    }
    setFile(null); setPdfDoc(null); setEdits([]); setCustomMarks([]);
    setStrokes([]); setCurrentPage(1); setActiveItemData(null);
    setActiveCustomMark(null); setReportType(null); setActiveTool('select');
  };

  const handleAddKSU = () => {
    if (!file) return;
    setCustomMarks(prev => [...prev, {
      id: `ksu-${Date.now()}`,
      pageIndex: -1,
      text: 'Fecha del informe - Aseguramiento de la Calidad - CC : 8400 - KSU: 7.2 - Clasificacion : Interno',
      x: CM_TO_PT * 2,
      y: CM_TO_PT,
      fontSize: 9,
    }]);
  };

  const handleEraseItem = (pageIndex: number, itemIndex: number, item: any) => {
    handleEdit(pageIndex, itemIndex, item, '');
  };

  const removeCustomMark = (id: string) => {
    setCustomMarks(prev => prev.filter(m => m.id !== id));
  };

  const addTextMark = (mark: CustomMark) => {
    setCustomMarks(prev => [...prev, mark]);
  };

  const modeLabel = reportType === 'engranaje' ? 'Engranaje' : reportType === 'zeiss' ? 'Zeiss' : 'PDF';

  return (
    <div className="h-screen flex flex-col bg-paper overflow-hidden">
      {/* Header */}
      <header className="h-14 bg-white border-b border-neutral-200 flex items-center justify-between px-6 flex-shrink-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-black rounded flex flex-col items-center justify-center gap-0.5">
            <div className="w-4 h-0.5 bg-white" />
            <div className="w-4 h-0.5 bg-white" />
          </div>
          <h1 className="font-bold text-xs uppercase tracking-[0.2em]">Editor Informes Metrología</h1>
        </div>

        <div className="flex items-center gap-3">
          {file && (
            <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
              {modeLabel}: <span className="text-neutral-700">{file.name}</span>
            </span>
          )}
          {file && (
            <>
              <button onClick={reset} className="btn-editorial border border-neutral-300 rounded hover:bg-neutral-50 px-4">
                Reiniciar
              </button>
              <button
                onClick={downloadEditedPdf}
                disabled={isExporting}
                className="btn-editorial bg-black text-white rounded hover:bg-neutral-800 px-6"
              >
                {isExporting ? <Loader2 size={12} className="animate-spin" /> : 'Guardar PDF'}
              </button>
            </>
          )}
        </div>
      </header>

      {/* Toolbar */}
      <div className="h-10 bg-white border-b border-neutral-200 flex items-center px-4 gap-1 flex-shrink-0 z-40">
        {/* Tool buttons */}
        <span className="text-[9px] uppercase font-bold text-neutral-400 tracking-widest mr-2">Herramientas</span>

        <ToolBtn
          active={activeTool === 'select'}
          onClick={() => setActiveTool('select')}
          title="Seleccionar / Editar texto"
          disabled={!file}
        >
          <MousePointer2 size={14} />
        </ToolBtn>

        <ToolBtn
          active={activeTool === 'pen'}
          onClick={() => setActiveTool('pen')}
          title="Lapiz"
          disabled={!file}
        >
          <Pen size={14} />
        </ToolBtn>

        <ToolBtn
          active={activeTool === 'highlight'}
          onClick={() => setActiveTool('highlight')}
          title="Resaltador"
          disabled={!file}
        >
          <Highlighter size={14} />
        </ToolBtn>

        <ToolBtn
          active={activeTool === 'text'}
          onClick={() => setActiveTool('text')}
          title="Escribir texto"
          disabled={!file}
        >
          <Type size={14} />
        </ToolBtn>

        <ToolBtn
          active={activeTool === 'eraser'}
          onClick={() => setActiveTool('eraser')}
          title="Borrador"
          disabled={!file}
        >
          <Eraser size={14} />
        </ToolBtn>

        {/* Pen color swatches */}
        {activeTool === 'pen' && (
          <div className="flex items-center gap-1 ml-3 border-l border-neutral-200 pl-3">
            <span className="text-[9px] uppercase font-bold text-neutral-400 mr-1">Color</span>
            {PEN_COLORS.map(c => (
              <button
                key={c.value}
                title={c.name}
                onClick={() => setPenColor(c.value)}
                className={cn(
                  'w-5 h-5 rounded-full border-2 transition-transform',
                  penColor === c.value ? 'border-black scale-125' : 'border-transparent hover:scale-110',
                )}
                style={{ backgroundColor: c.value }}
              />
            ))}
          </div>
        )}

        {/* Highlight color swatches */}
        {activeTool === 'highlight' && (
          <div className="flex items-center gap-1 ml-3 border-l border-neutral-200 pl-3">
            <span className="text-[9px] uppercase font-bold text-neutral-400 mr-1">Color</span>
            {HIGHLIGHT_COLORS.map(c => (
              <button
                key={c.value}
                title={c.name}
                onClick={() => setHighlightColor(c.value)}
                className={cn(
                  'w-5 h-5 rounded border-2 transition-transform',
                  highlightColor === c.value ? 'border-black scale-125' : 'border-transparent hover:scale-110',
                )}
                style={{ backgroundColor: c.value, opacity: 0.8 }}
              />
            ))}
          </div>
        )}

        {/* Text tool options */}
        {activeTool === 'text' && (
          <div className="flex items-center gap-2 ml-3 border-l border-neutral-200 pl-3">
            <span className="text-[9px] uppercase font-bold text-neutral-400">Color</span>
            {TEXT_COLORS.map(c => (
              <button
                key={c.value}
                title={c.name}
                onClick={() => setTextColor(c.value)}
                className={cn(
                  'w-5 h-5 rounded-full border-2 transition-transform',
                  textColor === c.value ? 'border-black scale-125' : 'border-transparent hover:scale-110',
                )}
                style={{ backgroundColor: c.value }}
              />
            ))}
            <span className="text-[9px] uppercase font-bold text-neutral-400 ml-2">Tamaño</span>
            {TEXT_FONT_SIZES.map(sz => (
              <button
                key={sz}
                onClick={() => setTextFontSize(sz)}
                className={cn(
                  'px-1.5 py-0.5 text-[9px] font-bold rounded transition-all',
                  textFontSize === sz ? 'bg-black text-white' : 'text-neutral-500 hover:bg-neutral-100',
                )}
              >
                {sz}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={handleAddKSU}
            disabled={!file}
            title="Agregar pie de página KSU en todas las hojas"
            className="flex items-center gap-1.5 btn-editorial border border-neutral-300 rounded hover:bg-neutral-50 px-3 disabled:opacity-30 font-bold"
          >
            <span>KSU</span>
          </button>
          <button
            onClick={handlePrint}
            disabled={!file}
            title="Imprimir PDF"
            className="flex items-center gap-1.5 btn-editorial border border-neutral-300 rounded hover:bg-neutral-50 px-3 disabled:opacity-30"
          >
            <Printer size={13} />
            <span>Imprimir</span>
          </button>
        </div>
      </div>

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="sidebar p-5 shrink-0 overflow-y-auto">
          {/* Upload buttons — always visible */}
          <div className="mb-6">
            <label className="label-caps">Cargar Informe</label>
            <div className="space-y-2">
              <UploadButton label="Cargar Informe Zeiss"     onClick={() => triggerUpload('zeiss')} />
              <UploadButton label="Cargar Informe Engranaje" onClick={() => triggerUpload('engranaje')} />
              <UploadButton label="Cargar PDF"               onClick={() => triggerUpload('comun')} />
            </div>

            <input type="file" ref={zeissInputRef}  onChange={onFileChange} accept=".pdf" className="hidden" />
            <input type="file" ref={gearInputRef}   onChange={onFileChange} accept=".pdf" className="hidden" />
            <input type="file" ref={comunInputRef}  onChange={onFileChange} accept=".pdf" className="hidden" />
          </div>

          {/* Navigation */}
          {file && (
            <div>
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

        {/* Workspace */}
        <section className="flex-1 overflow-auto bg-canvas relative">
          <div className="flex flex-col items-center p-6 lg:p-12 min-h-full">
            {!file ? (
              <div className="flex-1 flex items-center justify-center text-neutral-400 font-mono text-xs uppercase tracking-widest min-h-[400px]">
                Esperando archivo...
              </div>
            ) : (
              <div key={`${file.name}-${currentPage}`}>
                <PDFPage
                pdfDoc={pdfDoc!}
                pageNumber={currentPage}
                edits={edits.filter(e => e.pageIndex === currentPage - 1)}
                activeEdit={activeEdit?.page === currentPage - 1 ? activeEdit.item : null}
                customMarks={customMarks.filter(m => m.pageIndex === -1 || m.pageIndex === currentPage - 1)}
                activeCustomMark={activeCustomMark}
                strokes={strokes.filter(s => s.pageIndex === currentPage - 1)}
                activeTool={activeTool}
                penColor={penColor}
                highlightColor={highlightColor}
                textColor={textColor}
                textFontSize={textFontSize}
                pageIndex={currentPage - 1}
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
                onAddStroke={addStroke}
                onAddTextMark={addTextMark}
                onEraseItem={(idx, item) => handleEraseItem(currentPage - 1, idx, item)}
                onRemoveCustomMark={removeCustomMark}
              />
              </div>
            )}
          </div>
        </section>

        {/* Inspector */}
        <aside className="inspector p-5 shrink-0">
          <label className="label-caps">Inspector</label>
          <AnimatePresence mode="wait">
            {activeItemData ? (
              <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-6">
                <div>
                  <span className="text-[10px] text-neutral-400 uppercase font-bold block mb-2">Familia</span>
                  <div className="bg-neutral-100 p-2 rounded text-xs font-mono truncate">{activeItemData.fontName || 'Predeterminado'}</div>
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
                    <div className="bg-neutral-100 p-2 rounded text-xs font-mono">{Math.round(activeItemData.width)}px</div>
                  </div>
                </div>
              </motion.div>
            ) : activeCustomMark ? (
              <p className="text-[10px] text-neutral-500 leading-relaxed">Bloque libre. Doble click para editar. Arrastrar para mover.</p>
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
        <div className="fixed inset-0 bg-white/60 backdrop-blur-sm z-[100] flex flex-col items-center justify-center gap-4">
          <Loader2 size={32} className="animate-spin" />
          <p className="text-[10px] font-bold uppercase tracking-[0.3em]">Cargando...</p>
        </div>
      )}
    </div>
  );
}

/* ─── Small UI components ─── */

function ToolBtn({ active, onClick, title, disabled, children }: {
  active: boolean; onClick: () => void; title: string; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        'w-8 h-8 flex items-center justify-center rounded transition-all disabled:opacity-30',
        active ? 'bg-black text-white' : 'text-neutral-600 hover:bg-neutral-100',
      )}
    >
      {children}
    </button>
  );
}

function UploadButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full py-3 border-2 border-dashed border-neutral-200 rounded-xl flex items-center justify-center gap-2 hover:border-neutral-400 hover:bg-neutral-50 transition-all"
    >
      <Upload size={13} className="text-neutral-400" />
      <span className="text-[10px] uppercase font-bold text-neutral-600 tracking-wider">{label}</span>
    </button>
  );
}

/* ─── PDF Page ─── */

interface PDFPageProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  pageIndex: number;
  edits: TextMark[];
  activeEdit: number | null;
  customMarks: CustomMark[];
  activeCustomMark: string | null;
  strokes: DrawingStroke[];
  activeTool: ActiveTool;
  penColor: string;
  highlightColor: string;
  textColor: string;
  textFontSize: number;
  onSetActive: (itemIndex: number, item: any) => void;
  onUpdateItem: (index: number, originalItem: any, text: string) => void;
  onSelectCustomMark: (id: string) => void;
  onUpdateCustomMark: (id: string, patch: Partial<CustomMark>) => void;
  onAddStroke: (stroke: DrawingStroke) => void;
  onAddTextMark: (mark: CustomMark) => void;
  onEraseItem: (index: number, item: any) => void;
  onRemoveCustomMark: (id: string) => void;
}

function PDFPage({
  pdfDoc, pageNumber, pageIndex,
  edits, activeEdit,
  customMarks, activeCustomMark,
  strokes, activeTool, penColor, highlightColor, textColor, textFontSize,
  onSetActive, onUpdateItem,
  onSelectCustomMark, onUpdateCustomMark,
  onAddStroke, onAddTextMark, onEraseItem, onRemoveCustomMark,
}: PDFPageProps) {
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef     = useRef<HTMLDivElement>(null);
  const renderTaskRef    = useRef<any>(null);

  const [textItems,    setTextItems]   = useState<any[]>([]);
  const [viewport,     setViewport]    = useState<pdfjsLib.PageViewport | null>(null);
  const [dimensions,   setDimensions]  = useState({ width: 0, height: 0 });
  const [isRendering,  setIsRendering] = useState(true);
  const [pageHeightPt, setPageHeightPt] = useState(0);
  const [editingMarkId, setEditingMarkId] = useState<string | null>(null);

  const currentPointsRef = useRef<{ x: number; y: number }[]>([]);
  const isDrawingRef     = useRef(false);

  // ── PDF rendering ──
  useEffect(() => {
    let isMounted = true;
    const renderPage = async () => {
      if (renderTaskRef.current) {
        try { await renderTaskRef.current.cancel(); } catch (_) {}
      }
      setIsRendering(true);
      try {
        const page = await pdfDoc.getPage(pageNumber);
        const vp   = page.getViewport({ scale: PDF_SCALE });
        if (!isMounted) return;
        setViewport(vp);
        setPageHeightPt(vp.height / PDF_SCALE);
        setDimensions({ width: vp.width, height: vp.height });

        if (canvasRef.current) {
          const canvas  = canvasRef.current;
          const context = canvas.getContext('2d');
          canvas.width  = vp.width;
          canvas.height = vp.height;
          // @ts-ignore — pdfjs-dist RenderParameters type is outdated
          const task = page.render({ canvasContext: context!, viewport: vp });
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

  // ── Sync drawing canvas size with PDF canvas ──
  useEffect(() => {
    const dc = drawingCanvasRef.current;
    if (!dc || dimensions.width === 0) return;
    dc.width  = dimensions.width;
    dc.height = dimensions.height;
    redrawAll();
  }, [dimensions]);

  // ── Redraw when stored strokes change ──
  useEffect(() => {
    redrawAll();
  }, [strokes, pageHeightPt]);

  const pdfToCanvas = useCallback((pt: { x: number; y: number }) => ({
    x: pt.x * PDF_SCALE,
    y: (pageHeightPt - pt.y) * PDF_SCALE,
  }), [pageHeightPt]);

  const canvasToPdf = useCallback((cx: number, cy: number) => ({
    x: cx / PDF_SCALE,
    y: pageHeightPt - cy / PDF_SCALE,
  }), [pageHeightPt]);

  const drawStroke = (ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], tool: 'pen' | 'highlight', color: string) => {
    if (pts.length < 2) return;
    ctx.save();
    ctx.beginPath();
    if (tool === 'highlight') {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = color;
      ctx.lineWidth   = HIGHLIGHT_WIDTH_PT * PDF_SCALE;
      ctx.lineCap     = 'square';
      ctx.lineJoin    = 'round';
    } else {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth   = PEN_WIDTH_PT * PDF_SCALE;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
    }
    const first = pdfToCanvas(pts[0]);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i++) {
      const p = pdfToCanvas(pts[i]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  };

  const redrawAll = useCallback(() => {
    const dc = drawingCanvasRef.current;
    if (!dc) return;
    const ctx = dc.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, dc.width, dc.height);
    for (const stroke of strokes) {
      drawStroke(ctx, stroke.points, stroke.tool, stroke.color);
    }
    // current in-progress stroke
    if (currentPointsRef.current.length > 1) {
      const tool  = activeTool === 'highlight' ? 'highlight' : 'pen';
      const color = tool === 'highlight' ? highlightColor : penColor;
      drawStroke(ctx, currentPointsRef.current, tool, color);
    }
  }, [strokes, pageHeightPt, activeTool, penColor, highlightColor]);

  // ── Drawing mouse handlers ──
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool === 'select' || activeTool === 'eraser') return;
    const dc   = drawingCanvasRef.current;
    if (!dc) return;
    const rect = dc.getBoundingClientRect();
    const cx   = e.clientX - rect.left;
    const cy   = e.clientY - rect.top;

    if (activeTool === 'text') {
      const pdfPos = canvasToPdf(cx, cy);
      const newId = `text-mark-${Date.now()}`;
      onAddTextMark({
        id: newId,
        pageIndex,
        text: '',
        x: pdfPos.x,
        y: pdfPos.y,
        fontSize: textFontSize,
        color: textColor,
      });
      setEditingMarkId(newId);
      e.preventDefault();
      return;
    }

    currentPointsRef.current = [canvasToPdf(cx, cy)];
    isDrawingRef.current = true;
    e.preventDefault();
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || activeTool === 'select' || activeTool === 'text' || activeTool === 'eraser') return;
    const dc   = drawingCanvasRef.current;
    if (!dc) return;
    const rect = dc.getBoundingClientRect();
    const cx   = e.clientX - rect.left;
    const cy   = e.clientY - rect.top;
    currentPointsRef.current.push(canvasToPdf(cx, cy));
    redrawAll();
  };

  const handleMouseUp = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const pts = currentPointsRef.current;
    if (pts.length >= 2) {
      const tool: 'pen' | 'highlight' = activeTool === 'highlight' ? 'highlight' : 'pen';
      onAddStroke({
        id: `stroke-${Date.now()}`,
        pageIndex,
        tool,
        color:       tool === 'highlight' ? highlightColor : penColor,
        lineWidthPt: tool === 'highlight' ? HIGHLIGHT_WIDTH_PT : PEN_WIDTH_PT,
        points: [...pts],
      });
    }
    currentPointsRef.current = [];
  };

  // ── Coordinate helpers for text layer ──
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
    const startX = e.clientX, startY = e.clientY;
    const origX = mark.x,    origY = mark.y;
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

  const drawingActive = (activeTool === 'pen' || activeTool === 'highlight' || activeTool === 'text') && !editingMarkId;

  return (
    <div
      className="pdf-container mb-12 shadow-2xl"
      style={{ width: dimensions.width, height: dimensions.height }}
      ref={containerRef}
    >
      <canvas ref={canvasRef} className="block" />

      {/* Drawing canvas — on top, captures events when tool is pen/highlight */}
      <canvas
        ref={drawingCanvasRef}
        className="absolute inset-0"
        style={{
          cursor: activeTool === 'text' ? 'text' : drawingActive ? 'crosshair' : 'default',
          pointerEvents: drawingActive ? 'all' : 'none',
          zIndex: 50,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {/* Text + custom marks layer */}
      {!isRendering && viewport && (
        <div
          className="absolute inset-0 z-10 select-none overflow-hidden"
          style={{
            pointerEvents: drawingActive ? 'none' : 'auto',
            cursor: activeTool === 'eraser' ? 'cell' : 'auto',
          }}
        >
          {textItems.map((item: any, idx) => {
            if (!item.str.trim()) return null;
            const edit        = edits.find(e => e.itemIndex === idx);
            const isEdited    = !!edit;
            const displayText = edit ? edit.newText : item.str;
            const transform   = item.transform;
            const fontSizePdf = Math.abs(transform[3]);
            const [vx, vy_bl] = viewport.convertToViewportPoint(transform[4], transform[5]);
            const [, vy_top]  = viewport.convertToViewportPoint(transform[4], transform[5] + fontSizePdf);
            const finalX    = vx;
            const finalY    = vy_top + 4;
            const fontSizePx = Math.abs(vy_bl - vy_top);
            const isActive  = activeEdit === idx;

            return (
              <div key={idx}>
                <div
                  className={cn('text-layer-item group', isEdited && 'is-edited')}
                  style={{
                    left: `${finalX}px`, top: `${finalY}px`,
                    fontSize: `${fontSizePx}px`,
                    minWidth: `${item.width * viewport.scale}px`,
                    height: `${fontSizePx}px`,
                    opacity: isActive ? 0 : 1,
                    zIndex: isEdited ? 30 : 20,
                  }}
                  onClick={e => {
                    e.stopPropagation();
                    if (activeTool === 'eraser') { onEraseItem(idx, item); return; }
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
                      left: `${finalX}px`, top: `${finalY}px`,
                      width: `${Math.max(item.width * viewport.scale, 160)}px`,
                      height: `${fontSizePx * 1.3}px`,
                      fontSize: `${fontSizePx}px`,
                      lineHeight: '1',
                    }}
                    onBlur={e => onUpdateItem(idx, item, e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onUpdateItem(idx, item, (e.target as any).value); }
                      if (e.key === 'Escape') onUpdateItem(idx, item, displayText);
                    }}
                  />
                )}
              </div>
            );
          })}

          {/* Custom marks */}
          {customMarks.map(mark => {
            const { x: sx, y: sy } = pdfToScreen(mark.x, mark.y);
            const fontSizePx = mark.fontSize * PDF_SCALE;
            const topPx      = sy - fontSizePx;
            const isActive   = activeCustomMark === mark.id;
            const isEditing  = editingMarkId === mark.id;

            const commonStyle: React.CSSProperties = {
              left: `${sx}px`, top: `${topPx}px`,
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
                    zIndex: 100,
                    color: mark.color || '#000000',
                  }}
                  onBlur={e => { onUpdateCustomMark(mark.id, { text: e.target.value }); setEditingMarkId(null); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onUpdateCustomMark(mark.id, { text: (e.target as any).value }); setEditingMarkId(null); }
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
                  activeTool === 'eraser' ? 'cursor-cell' : 'cursor-move',
                  isActive ? 'ring-1 ring-blue-400 bg-blue-50/40' : 'hover:ring-1 hover:ring-neutral-300',
                )}
                style={{ ...commonStyle, zIndex: 60, color: mark.color || '#000000' }}
                onMouseDown={e => {
                  if (activeTool === 'eraser') { e.stopPropagation(); onRemoveCustomMark(mark.id); return; }
                  startDrag(e, mark);
                }}
                onDoubleClick={e => {
                  if (activeTool === 'eraser') return;
                  e.stopPropagation(); onSelectCustomMark(mark.id); setEditingMarkId(mark.id);
                }}
                title={activeTool === 'eraser' ? 'Click para borrar' : 'Doble click para editar · Arrastrar para mover'}
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
