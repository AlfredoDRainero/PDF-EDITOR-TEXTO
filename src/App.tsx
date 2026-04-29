/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { 
  FileText, 
  Upload, 
  Download, 
  X, 
  ChevronLeft, 
  ChevronRight, 
  Loader2,
  CheckCircle2
} from 'lucide-react';
import { cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

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

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [edits, setEdits] = useState<TextMark[]>([]);
  const [activeEdit, setActiveEdit] = useState<{ page: number; item: number } | null>(null);
  const [activeItemData, setActiveItemData] = useState<any | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      loadPdf(selectedFile);
    }
  };

  const loadPdf = async (file: File) => {
    setIsLoading(true);
    setEdits([]);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const doc = await loadingTask.promise;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
      setFile(file);
      setCurrentPage(1);
    } catch (error) {
      console.error('Error loading PDF:', error);
      alert('Error loading PDF file. Please try again.');
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

  const downloadEditedPdf = async () => {
    if (!file || edits.length === 0) return;
    setIsExporting(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      for (const edit of edits) {
        const pages = pdfDoc.getPages();
        const page = pages[edit.pageIndex];
        
        // Hide original text with a white rectangle.
        page.drawRectangle({
          x: edit.x,
          y: edit.y - (edit.fontSize * 0.15), // Ajuste fino para cubrir descendentes
          width: edit.width,
          height: edit.fontSize * 1.2,
          color: rgb(1, 1, 1),
        });

        // Dibujar el nuevo texto
        page.drawText(edit.newText, {
          x: edit.x,
          y: edit.y,
          size: edit.fontSize,
          font: font,
          color: rgb(0, 0, 0),
        });
      }

      const pdfBytes = await pdfDoc.save();
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
    setCurrentPage(1);
    setActiveItemData(null);
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
                {isExporting ? <Loader2 size={12} className="animate-spin" /> : "Guardar PDF"}
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
              <div className="flex items-center space-x-3 p-2 hover:bg-neutral-50 rounded cursor-pointer text-gray-400 group">
                <Upload size={14} />
                <span className="text-xs">Imágenes</span>
              </div>
            </div>
          </div>

          {!file ? (
            <div className="mt-auto">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-6 border-2 border-dashed border-neutral-200 rounded-xl flex flex-col items-center justify-center hover:border-neutral-400 hover:bg-neutral-50 transition-all gap-2"
              >
                <div className="w-8 h-8 bg-neutral-100 rounded-full flex items-center justify-center text-neutral-400">
                  <Upload size={16} />
                </div>
                <span className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">Cargar PDF</span>
              </button>
              <input type="file" ref={fileInputRef} onChange={onFileChange} accept=".pdf" className="hidden" />
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
                onSetActive={(itemIndex, item) => {
                  setActiveEdit({ page: currentPage - 1, item: itemIndex });
                  setActiveItemData(item);
                }}
                onUpdateItem={(index, item, text) => handleEdit(currentPage - 1, index, item, text)}
              />
            )}
          </div>
        </section>

        {/* Inspector Sidebar */}
        <aside className="inspector p-5 shrink-0">
          <label className="label-caps">Inspector de Tipografía</label>
          
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
                    {activeItemData.fontName || "Predeterminado"}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] text-neutral-400 uppercase font-bold block mb-2">Tamaño</span>
                    <div className="bg-neutral-100 p-2 rounded text-xs font-mono">
                      {Math.round(Math.sqrt(activeItemData.transform[0]**2 + activeItemData.transform[1]**2))}px
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-neutral-400 uppercase font-bold block mb-2">Ancho</span>
                    <div className="bg-neutral-100 p-2 rounded text-xs font-mono">
                      {Math.round(activeItemData.width)}px
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-neutral-100">
                  <label className="label-caps">Contexto de Edición</label>
                  <p className="text-[10px] leading-relaxed text-neutral-400 italic">
                    Editando segmento de texto original. El sistema mantiene las restricciones de estilo y posición para asegurar la consistencia del documento original.
                  </p>
                </div>
              </motion.div>
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
  onSetActive: (itemIndex: number, item: any) => void;
  onUpdateItem: (index: number, originalItem: any, text: string) => void;
}

function PDFPage({ pdfDoc, pageNumber, edits, activeEdit, onSetActive, onUpdateItem }: PDFPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<any>(null);
  const [textItems, setTextItems] = useState<any[]>([]);
  const [viewport, setViewport] = useState<pdfjsLib.PageViewport | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isRendering, setIsRendering] = useState(true);

  useEffect(() => {
    let isMounted = true;
    
    const renderPage = async () => {
      // Cancel previous task if it exists
      if (renderTaskRef.current) {
        try {
          await renderTaskRef.current.cancel();
        } catch (e) {
          // Task might already be finished
        }
      }

      setIsRendering(true);
      try {
        const page = await pdfDoc.getPage(pageNumber);
        const vp = page.getViewport({ scale: 1.5 });
        
        if (!isMounted) return;

        setViewport(vp);
        setDimensions({ 
          width: vp.width, 
          height: vp.height
        });

        if (canvasRef.current) {
          const canvas = canvasRef.current;
          const context = canvas.getContext('2d');
          canvas.width = vp.width;
          canvas.height = vp.height;

          const renderContext = {
            canvasContext: context!,
            viewport: vp,
          };
          
          const task = page.render(renderContext);
          renderTaskRef.current = task;
          await task.promise;
          
          if (!isMounted) return;
          
          const content = await page.getTextContent();
          setTextItems(content.items);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'RenderingCancelledException') {
          return;
        }
        console.error('Render error:', err);
      } finally {
        if (isMounted) setIsRendering(false);
      }
    };

    renderPage();

    return () => {
      isMounted = false;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [pdfDoc, pageNumber]);

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
            
            // Calculamos con precisión la posición superior e inferior (baseline)
            // convirtiendo ambos puntos desde el espacio PDF al espacio de la pantalla (viewport)
            const [vx, vy_baseline] = viewport.convertToViewportPoint(transform[4], transform[5]);
            const [, vy_top] = viewport.convertToViewportPoint(transform[4], transform[5] + fontSizePdf);
            
            // Ajustamos verticalmente para alinear con el texto original (total +4px)
            const finalX = vx;
            const finalY = vy_top + 4;
            const fontSizePx = Math.abs(vy_baseline - vy_top);

            const isActive = activeEdit === idx;

            return (
              <div key={idx}>
                <div 
                  className={cn(
                    "text-layer-item group",
                    isEdited && "is-edited"
                  )}
                  style={{
                    left: `${finalX}px`,
                    top: `${finalY}px`,
                    fontSize: `${fontSizePx}px`,
                    minWidth: `${item.width * viewport.scale}px` || 'auto',
                    height: `${fontSizePx}px`,
                    opacity: isActive ? 0 : 1,
                    zIndex: isEdited ? 30 : 20
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetActive(idx, item);
                  }}
                >
                  {isEdited ? displayText : ""}
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
                    onBlur={(e) => onUpdateItem(idx, item, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        onUpdateItem(idx, item, (e.target as any).value);
                      }
                      if (e.key === 'Escape') {
                        onUpdateItem(idx, item, displayText);
                      }
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

