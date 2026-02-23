"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createRoot } from "react-dom/client";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { ModernBoldTemplate } from "./templates/ModernBoldTemplate";
import { MinimalCleanTemplate } from "./templates/MinimalCleanTemplate";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  FileText,
  Sparkles,
  LayoutTemplate,
  Mail,
  Download,
  Printer,
  MoreVertical,
} from "lucide-react";

import {
  QUOTATION_TEMPLATES,
  DEFAULT_QUOTATION_DATA,
  QuotationData,
} from "./quotation-templates";
import { QuotationPreviewModal } from "./quotation-preview-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { YallaClassicTemplate } from "./templates/YallaClassicTemplate";

export function QuotationTemplatesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<QuotationData | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Modal state (used for advanced actions like email/PDF)
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Template preview state (for now only Yalla Classic, with/without discount)
  const [discountMode, setDiscountMode] = useState<"with" | "without">("with");
  const yallaClassicTemplate =
    QUOTATION_TEMPLATES.find((t) => t.id === "yalla-classic") ?? QUOTATION_TEMPLATES[0];
    const [isGenerating, setIsGenerating] = useState(false);

  // ── Search handler ──────────────────────────────────────────────────────
  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) {
      toast.error("Please enter a quotation number or customer name.");
      return;
    }

    setIsSearching(true);
    setHasSearched(false);

    try {
      const response = await fetch("/api/get-estimate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: q }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch estimate");
      }

      const json: { success: boolean; quotation?: QuotationData } =
        await response.json();

      if (json.success && json.quotation) {
        setSearchResults(json.quotation);
        toast.success("Quotation data loaded!");
      } else {
        setSearchResults(null);
        toast.error("No quotation found for this ID.");
      }
    } catch (error) {
      console.error("Search error:", error);
      setSearchResults(null);
      toast.error("Failed to load quotation. Please try again.");
    } finally {
      setHasSearched(true);
      setIsSearching(false);
    }
  };

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    void handleSearch();
  };

  interface PDFGeneratorOptions {
    scale?: number;          // html2canvas scale — higher = sharper but bigger file (default: 2)
    imageFormat?: "JPEG" | "PNG"; // JPEG = smaller file, PNG = lossless (default: JPEG)
    imageQuality?: number;   // 0–1, only applies to JPEG (default: 0.92)
  }

  // ─── PDF Generator ────────────────────────────────────────────────────────────
// Renders template into a hidden off-screen div at FULL SIZE (794px).
// Uses React 18 createRoot API — no deprecated ReactDOM.render.
async function generatePDFBlob(
    templateId: string,
    data: QuotationData,
    options: PDFGeneratorOptions = {}
  ): Promise<Blob> {
    const {
      scale = 2,
      imageFormat = "JPEG",
      imageQuality = 0.92,
    } = options;
  
    // Off-screen container — position absolute so browser still performs layout
    const tempDiv = document.createElement("div");
    tempDiv.style.cssText = `
      position: absolute;
      left: -9999px;
      top: 0;
      width: 794px;
      background: #ffffff;
    `;
    document.body.appendChild(tempDiv);
  
    // React 18: createRoot instead of deprecated ReactDOM.render
    const root = createRoot(tempDiv);
  
    try {
      // Pick the right template
      let TemplateEl: React.ReactElement;
      switch (templateId) {
        case "modern-bold":
          TemplateEl = <ModernBoldTemplate data={data} />;
          break;
        case "minimal-clean":
          TemplateEl = <MinimalCleanTemplate data={data} />;
          break;
        default:
          TemplateEl = <YallaClassicTemplate data={data} />;
      }
  
      // Render and wait for React to flush + fonts/layout to settle
      await new Promise<void>((resolve) => {
        root.render(TemplateEl);
        // React 18 renders asynchronously — small timeout lets it fully paint
        setTimeout(resolve, 250);
      });
  
      // Use scrollHeight to capture FULL content height (not viewport-clipped)
      const canvas = await html2canvas(tempDiv, {
        useCORS: true,
        allowTaint: true,
        background: "#ffffff",
        logging: false,
        width: 794,
        height: tempDiv.scrollHeight - 50,
      //   windowWidth: 794,
      //   scrollX: 0,
      //   scrollY: 0,
        // ✅ Fix: html2canvas uses `scale` as a number passed via options cast
        // Some versions type it differently — cast to any to avoid TS(2353)
        ...({ scale } as object),
      });
  
      const imgData = canvas.toDataURL(
        `image/${imageFormat.toLowerCase()}`,
        imageQuality
      );
  
      // A4 portrait
      const PAGE_W_MM = 210;
      const PAGE_H_MM = 297;
  
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  
      const imgWidthMm = PAGE_W_MM;
      const imgHeightMm = (canvas.height * imgWidthMm) / canvas.width;
      console.log("🚀 ~ generatePDFBlob ~ imgHeightMm:", imgHeightMm)
      let heightLeft = imgHeightMm;
      let position = 0;
  
      // First page
      pdf.addImage(imgData, imageFormat, 0, position, imgWidthMm, imgHeightMm );
      console.log("🚀 ~ generatePDFBlob ~ heightLeft:", heightLeft)
      heightLeft -= PAGE_H_MM;
  
      // Additional pages
      while (heightLeft > 0) {
        position = heightLeft - imgHeightMm;
        pdf.addPage();
        pdf.addImage(imgData, imageFormat, 0, position, imgWidthMm, imgHeightMm);
        console.log("🚀 ~ generatePDFBlob ~ heightLeft:", heightLeft)
        heightLeft -= PAGE_H_MM;
      }
  
      return pdf.output("blob");
    } finally {
      // Always clean up — unmount React tree then remove DOM node
      root.unmount();
      if (document.body.contains(tempDiv)) {
        document.body.removeChild(tempDiv);
      }
    }
  }
  
  const toastId = 'dashboard-quotation-templates-download-pdf';

    // ── Download handler ──────────────────────────────────────────────────
    const handleDownloadPDF = async () => {
        setIsGenerating(true);
        toast.loading("Generating PDF...", { id: toastId });
        try {
          const blob = await generatePDFBlob(yallaClassicTemplate.id, activeData, {
            scale: 2,
            imageFormat: "JPEG",
            imageQuality: 0.92,
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          const safeName = activeData.quotationNumber.replace(/[\s/\\:*?"<>|]/g, "_");
          a.download = `Quotation_${safeName}.pdf`;
          a.click();
          URL.revokeObjectURL(url);
        
        } catch (err) {
          console.error(err);
          toast.error("Failed to generate PDF. Please try again.");
        } finally {
          setIsGenerating(false);
          toast.dismiss(toastId);
          toast.success("PDF downloaded successfully!");
        }
      };

  const activeData = searchResults ?? DEFAULT_QUOTATION_DATA;

  return (
   
      <Card className="w-full flex-1  relative top-px right-px gap-6">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex  gap-1 flex-col">
              <CardTitle className="text-xl flex items-center gap-2">
                <FileText className="size-5 text-primary" />
                Quotation Templates
              </CardTitle>
              <CardDescription>
                Search a quotation by number or customer name, pick a template, preview it, and send it via email.
              </CardDescription>
            </div>
        </CardHeader>

        <CardContent className="space-y-6">

      {/* ── Search card ── */}
      <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex-1 space-y-2">
              {/* <Label htmlFor="appointment-name">Quotation Number or Customer Name</Label> */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="quotation-number-or-customer-name"
                  placeholder="e.g. 17087 or Paddle Land..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  disabled={isSearching}
                  className="pl-9"
                />
              </div>
            </div>
            <Button type="submit" disabled={isSearching} className="w-full sm:w-auto gap-2 min-w-[110px]">
              {isSearching ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Searching…
                </>
              ) : (
                <>
                  <Search className="size-4" />
                  Search
                </>
              )}
            </Button>
          </form>

          
          {/* Loading skeleton */}
          {isSearching && (
            <Card className="border-dashed">
              <CardHeader>
                <Skeleton className="h-5 w-48" />
              </CardHeader>
              <CardContent className="space-y-4">
                {[32, 56, 40].map((w, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className={`h-4 w-${w > 50 ? "full max-w-md" : "full max-w-sm"}`} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          
         {/* Loaded data summary  */}
          {hasSearched && searchResults && (
            <div className="mt-4 flex items-center gap-3 p-3 bg-primary/5 rounded-lg border border-primary/20">
              <FileText className="size-5 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {searchResults.quotationNumber}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {searchResults.customerName} · {searchResults.quotationDate}
                </p>
              </div>
              <Badge variant="default" className="ml-auto shrink-0">Loaded</Badge>
            </div>
          )}

          {hasSearched && !searchResults && (
            <EmptyState
            title="No quotation found"
            description="The quotation you are looking for does not exist. Please check the number or customer name and try again."
            icon={<FileText className="" />}
            // action={{ label: "Try again", onClick: () => setSearchError(null), variant: "default" }}
           />
          )}
          {!hasSearched && !searchResults && !isSearching && (
            <EmptyState
            title="Search for a quotation"
            description="Enter the number or customer name of the quotation you are looking for and click the search button."
            icon={<Search className="" />}
           />
          )}
        
      
      {/* <Separator /> */}

      {/* ── Templates section ── */}
      {hasSearched && searchResults && yallaClassicTemplate && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles className="size-4 text-amber-500" />
                Template Preview
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Switch between quotation template modes and use quick actions.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
              <div className="flex items-center gap-2">
                {/* <Label className="text-xs text-muted-foreground">Mode:</Label> */}
                <Select
                  value={discountMode}
                  onValueChange={(value) =>
                    setDiscountMode(value as "with" | "without")
                  }
                >
                  <SelectTrigger className="w-[220px] h-8 text-xs">
                    <SelectValue placeholder="Select quotation template mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="with">
                      Quotation template with discount
                    </SelectItem>
                    <SelectItem value="without">
                      Quotation template without discount
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden bg-slate-100">
            <div className="flex items-center justify-between px-4 py-2 border-b bg-white">
              <div className="flex items-center gap-2">
                <LayoutTemplate className="size-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {yallaClassicTemplate.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {discountMode === "with"
                      ? "Showing totals with discount row"
                      : "Showing totals without discount row"}
                  </span>
                </div>
                <Badge variant="outline" className="ml-2 text-[10px]">
                  {yallaClassicTemplate.tag}
                </Badge>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-xs"
                  >
                    <MoreVertical className="size-3.5" />
                    Actions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    className="text-xs"
                    onClick={() => setIsModalOpen(true)}
                  >
                    <Mail className="mr-2 size-3.5" />
                    Send email
                  </DropdownMenuItem>
                  {/* <DropdownMenuItem
                    className="text-xs"
                    onClick={() => window.print()}
                  >
                    <Printer className="mr-2 size-3.5" />
                    Print
                  </DropdownMenuItem> */}
                  <DropdownMenuItem
                    className="text-xs"
                    onClick={handleDownloadPDF}
                    disabled={isGenerating}
                  >
                    <Download className="mr-2 size-3.5" />
                    Download PDF
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="bg-slate-100 overflow-auto flex items-start justify-center p-6">
              <div style={{ width: 794 * 0.68 }}>
                <div
                  style={{
                    transform: "scale(0.68)",
                    transformOrigin: "top left",
                    width: 794,
                    pointerEvents: "none",
                    userSelect: "none",
                    marginBottom: "-570px",
                  }}
                >
                  <div className="shadow-2xl ring-1 ring-black/5 rounded overflow-hidden bg-white">
                    <YallaClassicTemplate
                      data={activeData}
                      hideDiscount={discountMode === "without"}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {hasSearched && searchResults && yallaClassicTemplate && (
        <QuotationPreviewModal
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          template={yallaClassicTemplate}
          data={activeData}
        />
      )}
    </CardContent>
    </Card>
  );
}