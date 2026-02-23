"use client";

import { useState, useMemo } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Search,
  FileText,
  Sparkles,
  ChevronRight,
  LayoutTemplate,
} from "lucide-react";

import {
  QUOTATION_TEMPLATES,
  DEFAULT_QUOTATION_DATA,
  QuotationTemplate,
  QuotationData,
} from "./quotation-templates";
import { QuotationPreviewModal } from "./quotation-preview-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Mock "search" results for quotation data ──────────────────────────────
// Replace with real API calls when ready
const MOCK_QUOTATIONS: Record<string, QuotationData> = {
  "17087": DEFAULT_QUOTATION_DATA,
  "17088": {
    ...DEFAULT_QUOTATION_DATA,
    quotationNumber: "17088 IR 01",
    customerName: "GRAND ARENA LLC",
    customerContact: "Ali Hassan",
    customerPhone: "0509999999",
    customerEmail: "ali.hassan@grandarena.ae",
    serviceAddress: "Sheikh Zayed Road, Dubai, UAE",
    lineItems: [
      {
        description: "Flooring Repair & Replacement",
        details: "Removal of damaged vinyl tiles and replacement with new 3mm vinyl. Includes surface preparation.",
        quantity: 20,
        unit: "sqm",
        unitPrice: 85,
        taxRate: 5,
      },
      {
        description: "Painting — Interior Walls",
        details: "Two coats of premium emulsion paint on interior walls. Color as per client specification.",
        quantity: 150,
        unit: "sqm",
        unitPrice: 12,
        taxRate: 5,
      },
    ],
    discountAmount: 200,
  },
  "17090": {
    ...DEFAULT_QUOTATION_DATA,
    quotationNumber: "17090 IR 02",
    customerName: "HORIZON FACILITIES MANAGEMENT LLC",
    customerContact: "Rania Mousa",
    customerPhone: "0551234567",
    customerEmail: "rania.mousa@horizonfm.ae",
    serviceAddress: "Business Bay Tower 4, Dubai, UAE",
    lineItems: [
      {
        description: "AC Duct Cleaning",
        details: "Full duct cleaning service for central AC units. Sanitization and filter replacement included.",
        quantity: 6,
        unit: "units",
        unitPrice: 350,
        taxRate: 5,
      },
    ],
    discountAmount: 0,
  },
};

export function QuotationTemplatesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<QuotationData | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [filterTag, setFilterTag] = useState<string>("all");

  // Modal state
  const [selectedTemplate, setSelectedTemplate] = useState<QuotationTemplate | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // ── Search handler ──────────────────────────────────────────────────────
  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) {
      toast.error("Please enter a quotation number or customer name.");
      return;
    }

    setIsSearching(true);
    setHasSearched(false);

    // Simulate API delay
    await new Promise((r) => setTimeout(r, 800));

    // Find mock match
    const key = Object.keys(MOCK_QUOTATIONS).find(
      (k) =>
        k.includes(q) ||
        MOCK_QUOTATIONS[k].customerName.toLowerCase().includes(q.toLowerCase()) ||
        MOCK_QUOTATIONS[k].quotationNumber.toLowerCase().includes(q.toLowerCase())
    );

    if (key) {
      setSearchResults(MOCK_QUOTATIONS[key]);
      toast.success("Quotation data loaded!");
    } else {
      setSearchResults(null);
    //   toast.info("No quotation found — you can still use a template with default data.");
    }

    setHasSearched(true);
    setIsSearching(false);
  };

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    void handleSearch();
  };

  // ── Filter templates ────────────────────────────────────────────────────
  const filteredTemplates = useMemo(() => {
    if (filterTag === "all") return QUOTATION_TEMPLATES;
    return QUOTATION_TEMPLATES.filter(
      (t) => t.tag.toLowerCase() === filterTag.toLowerCase()
    );
  }, [filterTag]);

  const openTemplate = (template: QuotationTemplate) => {
    setSelectedTemplate(template);
    setIsModalOpen(true);
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
{hasSearched && searchResults && (
    <>
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Sparkles className="size-4 text-amber-500" />
              Choose a Template
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Select a design to preview and send
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Filter:</Label>
            <Select value={filterTag} onValueChange={setFilterTag}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Templates</SelectItem>
                <SelectItem value="Professional">Professional</SelectItem>
                <SelectItem value="Modern">Modern</SelectItem>
                <SelectItem value="Minimal">Minimal</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onSelect={() => openTemplate(template)}
            />
          ))}
        </div>
      </div>
 
      {/* ── Preview Modal ── */}
      {selectedTemplate && (
        <QuotationPreviewModal
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          template={selectedTemplate}
          data={activeData}
        />
      )}
      </>
      )}
    </CardContent>
    </Card>
  );
}

// ─── Template Card ────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  onSelect,
}: {
  template: QuotationTemplate;
  onSelect: () => void;
}) {
  return (
    <Card
      className="group cursor-pointer hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5 overflow-hidden py-0"
      onClick={onSelect}
    >
      {/* Preview area */}
      <div className={`h-36 bg-gradient-to-br ${template.previewBg} relative overflow-hidden`}>
        {/* Decorative mock lines */}
        <div className="absolute inset-4 space-y-2 opacity-60">
          <div className="flex justify-between">
            <div className="h-3 w-24 rounded" style={{ background: template.color, opacity: 0.8 }} />
            <div className="h-3 w-16 rounded bg-slate-300" />
          </div>
          <div className="h-1 w-full rounded bg-slate-200" />
          <div className="mt-3 space-y-1.5">
            {[80, 60, 70].map((w, i) => (
              <div key={i} className="h-2 rounded bg-slate-200" style={{ width: `${w}%` }} />
            ))}
          </div>
          <div className="mt-2 h-8 rounded" style={{ background: template.color, opacity: 0.2 }} />
          <div className="flex justify-end">
            <div className="h-4 w-24 rounded" style={{ background: template.color, opacity: 0.5 }} />
          </div>
        </div>

        {/* Badge */}
        <div className="absolute top-3 right-3">
          <Badge
            className="text-xs font-semibold shadow-sm"
            style={{ background: template.color, color: "#ffffff", border: "none" }}
          >
            {template.tag}
          </Badge>
        </div>
      </div>

      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate">{template.name}</h3>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {template.description}
            </p>
          </div>
          <ChevronRight className="size-4 text-muted-foreground shrink-0 mt-0.5 group-hover:translate-x-0.5 transition-transform" />
        </div>

        <div className="mt-3 flex gap-2">
          <Button size="sm" className="flex-1 text-xs h-8 gap-1.5" onClick={onSelect}>
            <FileText className="size-3" />
            Use Template
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}