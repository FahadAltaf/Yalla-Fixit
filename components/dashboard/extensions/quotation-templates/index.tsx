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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  Mail,
  Download,
  MoreVertical,
  AlertTriangle,
} from "lucide-react";

import {
  QUOTATION_TEMPLATES,
  QuotationData,
  calculateTotals,
} from "./quotation-templates";
import { QuotationPreviewModal } from "./quotation-preview-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { YallaClassicTemplate } from "./templates/YallaClassicTemplate";
import { generateQuotationPDFBlob } from "./pdf-utils";

export function QuotationTemplatesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<QuotationData | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);

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
        body: JSON.stringify({ name: q }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch estimate");
      }

      const json: {
        success: boolean;
        quotation?: QuotationData;
        currentStatus?: string | null;
      } = await response.json();

      if (json.success && json.quotation) {
        setSearchResults(json.quotation);
        setCurrentStatus(json.currentStatus ?? null);
        toast.success("Quotation data loaded!");
      } else {
        setSearchResults(null);
        setCurrentStatus(null);
        toast.error("No quotation found for this ID.");
      }
    } catch (error) {
      console.error("Search error:", error);
      setSearchResults(null);
      setCurrentStatus(null);
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

  const toastId = "dashboard-quotation-templates-download-pdf";
    // ── Download handler ──────────────────────────────────────────────────
    const handleDownloadPDF = async () => {
      if (!activeData) {
        toast.error("No quotation data found. Please search for a quotation first.");
        return;
      }
      setIsGenerating(true);
      toast.loading("Generating PDF...", { id: toastId });
      try {
        const blob = await generateQuotationPDFBlob(
          yallaClassicTemplate.id,
          activeData,
          {
            scale: 2,
            imageFormat: "JPEG",
            imageQuality: 0.92,
          },
          discountMode
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const safeName = activeData?.quotationNumber.replace(
          /[\s/\\:*?"<>|]/g,
          "_"
        );
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

  const activeData = searchResults ?? null;

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
                  placeholder="e.g 17086..."
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
          
          {/* Loaded data summary */}
          {hasSearched && searchResults && (
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-lg border border-primary/20">
                <FileText className="size-5 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {searchResults.quotationNumber} · {searchResults.customerCompanyName}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {searchResults.serviceAddress ?? "No service address"} ·{" "}
                    {searchResults.quotationDate}
                  </p>
                </div>
                <Badge variant="default" className="ml-auto shrink-0">
                  AED{" "}
                  {(
                    searchResults.grandTotal ??
                    calculateTotals(searchResults).grandTotal
                  ).toFixed(2)}
                </Badge>
              </div>

              {currentStatus && currentStatus.toLowerCase() !== "new" && (
                <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      <AlertTitle className="text-xs font-medium">
                        Quotation status: {currentStatus}
                      </AlertTitle>
                     
                    </div>
                  </div>
                </Alert>
              )}
            </div>
          )}

          {hasSearched && !searchResults && (
            <EmptyState
            title="No quotation found"
            description="The quotation you are looking for does not exist. Please check the name and try again."
            icon={<FileText className="" />}
            // action={{ label: "Try again", onClick: () => setSearchError(null), variant: "default" }}
           />
          )}
          {!hasSearched && !searchResults && !isSearching && (
            <EmptyState
            title="Search for a quotation"
            description="Enter the name of the quotation you are looking for and click the search button."
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
                  <SelectTrigger className="w-max h-8 text-xs">
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
                <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="gap-1 text-xs"
                  >
                    <MoreVertical className="size-3.5" />
                    {/* Actions */}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    className="text-xs"
                    onClick={() => setIsModalOpen(true)}
                  >
                    <Mail className="mr-2 size-3.5" />
                    {
                      currentStatus && currentStatus.toLowerCase() !== "new" ? "Resend email" : "Send email"
                    }
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
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden bg-slate-100">
         
            <div className="bg-slate-100 overflow-auto flex items-start justify-center p-6">
              <div style={{ width: 794 * 0.95 }}>
                <div
                  style={{
                    transform: "scale(0.95)",
                    transformOrigin: "top left",
                    width: 794,
                    pointerEvents: "none",
                    userSelect: "none",
                    // marginBottom: "-500px",
                  }}
                >
                  {
                    activeData && (
                      <div className="shadow-2xl ring-1 ring-black/5 rounded overflow-hidden bg-white">
                        <YallaClassicTemplate
                          data={activeData}
                          hideDiscount={discountMode === "without"}
                        />
                      </div>
                    )
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {hasSearched && searchResults && yallaClassicTemplate && activeData && (
        <QuotationPreviewModal
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          template={yallaClassicTemplate}
          data={activeData}
          discountMode={discountMode}
          shouldMarkAsSent={currentStatus === "New"}
          setCurrentStatus = {setCurrentStatus}
        />
      )}
    </CardContent>
    </Card>
  );
}