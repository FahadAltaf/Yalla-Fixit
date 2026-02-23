"use client";

import React, { useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Download,
  Mail,
  X,
  Plus,
  Send,
  Loader2,
  CheckCircle2,
  Eye,
  Users,
  User,
} from "lucide-react";

import { QuotationData, QuotationTemplate } from "./quotation-templates";
import { YallaClassicTemplate } from "./templates/YallaClassicTemplate";
import { ModernBoldTemplate } from "./templates/ModernBoldTemplate";
import { MinimalCleanTemplate } from "./templates/MinimalCleanTemplate";

// ─── Mock contacts ────────────────────────────────────────────────────────────
const MOCK_CONTACTS = [
  { id: "1", name: "Hussain Badri", email: "hussain.badri@padelae.com" },
  { id: "2", name: "Ahmed Al Rashid", email: "ahmed.rashid@example.com" },
  { id: "3", name: "Sara Khalid", email: "sara.khalid@company.ae" },
  { id: "4", name: "Omar Farooq", email: "omar.f@techsol.ae" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  template: QuotationTemplate;
  data: QuotationData;
}

type SendStatus = "idle" | "sending" | "sent" | "error";

// ─── PDF Generator Options ────────────────────────────────────────────────────
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
    pdf.addImage(imgData, imageFormat, 0, position, imgWidthMm, imgHeightMm);
    console.log("🚀 ~ generatePDFBlob ~ heightLeft:", heightLeft)
    heightLeft -= PAGE_H_MM;

    // Additional pages
    while (heightLeft > 0) {
      position = heightLeft - imgHeightMm;
      console.log("🚀 ~ generatePDFBlob ~ position:", position)
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

// ─── Modal Component ──────────────────────────────────────────────────────────
export function QuotationPreviewModal({ open, onClose, template, data }: Props) {
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [customEmail, setCustomEmail] = useState("");
  const [customEmails, setCustomEmails] = useState<string[]>([]);
  const [emailSubject, setEmailSubject] = useState(
    `Quotation ${data.quotationNumber} — ${data.companyName}`
  );
  const [emailMessage, setEmailMessage] = useState(
    `Dear ${data.customerContact || "Sir/Madam"},\n\nPlease find attached the quotation ${data.quotationNumber} for your reference.\n\nBest regards,\n${data.companyName}`
  );
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [isGenerating, setIsGenerating] = useState(false);

  // Visual preview component (scaled down, NOT used for PDF)
  const PreviewTemplate = useCallback(() => {
    switch (template.id) {
      case "modern-bold": return <ModernBoldTemplate data={data} />;
      case "minimal-clean": return <MinimalCleanTemplate data={data} />;
      default: return <YallaClassicTemplate data={data} />;
    }
  }, [template.id, data]);

  // ── Download handler ──────────────────────────────────────────────────
  const handleDownloadPDF = async () => {
    setIsGenerating(true);
    try {
      const blob = await generatePDFBlob(template.id, data, {
        scale: 2,
        imageFormat: "JPEG",
        imageQuality: 0.92,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = data.quotationNumber.replace(/[\s/\\:*?"<>|]/g, "_");
      a.download = `Quotation_${safeName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF downloaded successfully!");
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate PDF. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Email helpers ─────────────────────────────────────────────────────
  const toggleContact = (id: string) => {
    setSelectedContacts((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const addCustomEmail = () => {
    const email = customEmail.trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Please enter a valid email address.");
      return;
    }
    if (customEmails.includes(email)) {
      toast.error("Email already added.");
      return;
    }
    setCustomEmails((prev) => [...prev, email]);
    setCustomEmail("");
  };

  const removeCustomEmail = (email: string) =>
    setCustomEmails((prev) => prev.filter((e) => e !== email));

  const allRecipients = [
    ...MOCK_CONTACTS.filter((c) => selectedContacts.includes(c.id)).map((c) => c.email),
    ...customEmails,
  ];

  const handleSendEmail = async () => {
    if (allRecipients.length === 0) {
      toast.error("Please add at least one recipient.");
      return;
    }
    setSendStatus("sending");
    try {
      const pdfBlob = await generatePDFBlob(template.id, data, {
        scale: 2,
        imageFormat: "JPEG",
        imageQuality: 0.92,
      });

      // ── Replace below with real API call ──
      // const formData = new FormData();
      // formData.append("recipients", JSON.stringify(allRecipients));
      // formData.append("subject", emailSubject);
      // formData.append("message", emailMessage);
      // formData.append("attachment", pdfBlob, `Quotation_${data.quotationNumber}.pdf`);
      // await fetch("/api/send-quotation-email", { method: "POST", body: formData });

      await new Promise((r) => setTimeout(r, 2000)); // mock delay
      setSendStatus("sent");
      toast.success(`Sent to ${allRecipients.length} recipient(s)!`);
    } catch {
      setSendStatus("error");
      toast.error("Failed to send. Please try again.");
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[1100px] w-full h-[92vh] p-0 gap-0 flex flex-col overflow-hidden min-w-[1100px]" showCloseButton={false}>

        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="size-3 rounded-full" style={{ background: template.color }} />
              <DialogTitle className="text-base">{template.name}</DialogTitle>
              <Badge variant="outline" className="text-xs">{template.tag}</Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadPDF}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <><Loader2 className="size-4 animate-spin mr-2" />Generating…</>
              ) : (
                <><Download className="size-4 mr-2" />Download PDF</>
              )}
            </Button>
          </div>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">

          {/* ── Left: visual preview (CSS scale only, NOT captured for PDF) ── */}
          <div className="flex-1 bg-slate-100 overflow-auto flex items-start justify-center p-8">
            {/*
              IMPORTANT: This div uses CSS transform:scale() for display only.
              The actual PDF is generated from a separate off-screen full-size render.
              This means what you see here is pixel-perfect what the PDF will look like.
            */}
            <div style={{ width: 794 * 0.68 }}>
              <div
                style={{
                  transform: "scale(0.68)",
                  transformOrigin: "top left",
                  width: 794,
                  pointerEvents: "none",
                  userSelect: "none",
                  marginBottom: "-470px",
                }}
              >
                <div className="shadow-2xl ring-1 ring-black/5 rounded overflow-hidden">
                  <PreviewTemplate />
                </div>
              </div>
            </div>
          </div>

          <Separator orientation="vertical" />

          {/* ── Right: info + email panel ── */}
          <div className="w-[380px] flex flex-col shrink-0 overflow-y-auto">
            <Tabs defaultValue="email" className="flex flex-col flex-1">
              <TabsList className="mx-4 mt-4 shrink-0">
                <TabsTrigger value="preview" className="flex-1 gap-2 text-xs">
                  <Eye className="size-3" /> Preview Info
                </TabsTrigger>
                <TabsTrigger value="email" className="flex-1 gap-2 text-xs">
                  <Mail className="size-3" /> Send Email
                </TabsTrigger>
              </TabsList>

              {/* Preview info */}
              <TabsContent value="preview" className="flex-1 m-0">
                <ScrollArea className="h-full px-4 py-4">
                  <div className="space-y-4">
                    <div>
                      <Label className="text-xs text-muted-foreground uppercase tracking-wide">Quotation #</Label>
                      <p className="font-semibold mt-1">{data.quotationNumber}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground uppercase tracking-wide">Customer</Label>
                      <p className="font-semibold mt-1 text-sm">{data.customerName}</p>
                      {data.customerEmail && (
                        <p className="text-xs text-muted-foreground">{data.customerEmail}</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground uppercase tracking-wide">Line Items</Label>
                      <div className="mt-2 space-y-2">
                        {data.lineItems.map((item, i) => (
                          <div key={i} className="bg-muted/50 rounded-md p-3">
                            <p className="text-sm font-medium">{item.description}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {item.quantity} × AED {item.unitPrice.toFixed(2)} = AED{" "}
                              {(item.quantity * item.unitPrice).toFixed(2)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <Separator />
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Template</span><span>{template.name}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Date</span><span>{data.quotationDate}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-base pt-1 border-t mt-2">
                        <span>Grand Total</span>
                        <span>
                          AED{" "}
                          {(
                            data.lineItems.reduce((s, item) => {
                              const base = item.quantity * item.unitPrice;
                              return s + base + (base * item.taxRate) / 100;
                            }, 0) - (data.discountAmount ?? 0)
                          ).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* Email tab */}
              <TabsContent value="email" className="flex-1 overflow-hidden m-0 flex flex-col">
                <ScrollArea className="flex-1">
                  <div className="px-4 py-4 space-y-5">
                    {sendStatus === "sent" ? (
                      <div className="flex flex-col items-center gap-3 py-8 text-center">
                        <CheckCircle2 className="size-14 text-green-500 animate-in zoom-in-50" />
                        <p className="font-semibold">Sent Successfully!</p>
                        <p className="text-sm text-muted-foreground">
                          Quotation sent to {allRecipients.length} recipient(s).
                        </p>
                        <Button variant="outline" size="sm" onClick={() => setSendStatus("idle")}>
                          Send Again
                        </Button>
                      </div>
                    ) : (
                      <>
                        {/* Contact selector */}
                        <div className="space-y-2">
                          <Label className="flex items-center gap-2 text-sm">
                            <Users className="size-3.5" /> Select Contacts
                          </Label>
                          <div className="space-y-1.5">
                            {MOCK_CONTACTS.map((contact) => {
                              const selected = selectedContacts.includes(contact.id);
                              return (
                                <button
                                  key={contact.id}
                                  type="button"
                                  onClick={() => toggleContact(contact.id)}
                                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md border text-left transition-colors text-sm ${
                                    selected
                                      ? "border-primary bg-primary/5"
                                      : "border-border hover:bg-muted/50"
                                  }`}
                                >
                                  <div className={`size-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                    selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                                  }`}>
                                    {contact.name[0]}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-medium truncate">{contact.name}</p>
                                    <p className="text-xs text-muted-foreground truncate">{contact.email}</p>
                                  </div>
                                  {selected && <CheckCircle2 className="size-4 text-primary ml-auto shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <Separator />

                        {/* Custom email */}
                        <div className="space-y-2">
                          <Label className="flex items-center gap-2 text-sm">
                            <User className="size-3.5" /> Add Custom Email
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              placeholder="email@example.com"
                              value={customEmail}
                              onChange={(e) => setCustomEmail(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && addCustomEmail()}
                              className="text-sm"
                            />
                            <Button type="button" size="icon" variant="outline" onClick={addCustomEmail}>
                              <Plus className="size-4" />
                            </Button>
                          </div>
                          {customEmails.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {customEmails.map((email) => (
                                <Badge key={email} variant="secondary" className="gap-1 pr-1">
                                  {email}
                                  <button type="button" onClick={() => removeCustomEmail(email)} className="ml-1 hover:text-destructive">
                                    <X className="size-3" />
                                  </button>
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>

                        <Separator />

                        {/* Subject + Message */}
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label className="text-sm">Subject</Label>
                            <Input
                              value={emailSubject}
                              onChange={(e) => setEmailSubject(e.target.value)}
                              className="text-sm"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-sm">Message</Label>
                            <textarea
                              value={emailMessage}
                              onChange={(e) => setEmailMessage(e.target.value)}
                              rows={5}
                              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                        </div>

                        {allRecipients.length > 0 && (
                          <Alert>
                            <Mail className="size-4" />
                            <AlertDescription className="text-xs">
                              Sending to {allRecipients.length} recipient(s):{" "}
                              <span className="font-medium">{allRecipients.join(", ")}</span>
                            </AlertDescription>
                          </Alert>
                        )}

                        {sendStatus === "error" && (
                          <Alert variant="destructive">
                            <AlertDescription>Failed to send. Please try again.</AlertDescription>
                          </Alert>
                        )}
                      </>
                    )}
                  </div>
                </ScrollArea>

                {sendStatus !== "sent" && (
                  <div className="p-4 border-t shrink-0">
                    <Button
                      className="w-full gap-2"
                      onClick={handleSendEmail}
                      disabled={sendStatus === "sending" || allRecipients.length === 0}
                    >
                      {sendStatus === "sending" ? (
                        <><Loader2 className="size-4 animate-spin" />Generating & Sending…</>
                      ) : (
                        <><Send className="size-4" />Send to {allRecipients.length} Recipient{allRecipients.length !== 1 ? "s" : ""}</>
                      )}
                    </Button>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}