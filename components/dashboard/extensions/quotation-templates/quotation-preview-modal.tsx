"use client";

import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Mail,
  X,
  Plus,
  Send,
  CheckCircle2,
  Users,
  User,
  MessageCircle,
} from "lucide-react";

import { QuotationData, QuotationTemplate } from "./quotation-templates";
import { YallaClassicTemplate } from "./templates/YallaClassicTemplate";
import { ModernBoldTemplate } from "./templates/ModernBoldTemplate";
import { MinimalCleanTemplate } from "./templates/MinimalCleanTemplate";
import { emailService } from "@/lib/email-service";
import { buildQuotationEmailHtml } from "./quotation-email-template";

interface Props {
  open: boolean;
  onClose: () => void;
  template: QuotationTemplate;
  data: QuotationData;
  discountMode: "with" | "without";
  /**
   * When false, the Zoho FSM "mark as sent" transition will not be
   * triggered after sending the email. This is useful when the
   * estimate is already in an Approved state and we only want to
   * resend the email from the dashboard.
   */
  shouldMarkAsSent?: boolean;
  setCurrentStatus: (status: string) => void; 
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
  options: PDFGeneratorOptions = {},
  discountMode: "with" | "without" = "with"
): Promise<Blob> {
  const { scale = 2, imageFormat = "JPEG", imageQuality = 0.92 } = options;

  const tempDiv = document.createElement("div");
  tempDiv.style.cssText = `
    position: absolute;
    left: -9999px;
    top: 0;
    width: 794px;
    background: #ffffff;
  `;
  document.body.appendChild(tempDiv);

  const root = createRoot(tempDiv);

  try {
    let TemplateEl: React.ReactElement;
    switch (templateId) {
      case "modern-bold": TemplateEl = <ModernBoldTemplate data={data} />; break;
      case "minimal-clean": TemplateEl = <MinimalCleanTemplate data={data} />; break;
      default: TemplateEl = <YallaClassicTemplate data={data} forPDF                       hideDiscount={discountMode === "without"}
      />;
    }

    await new Promise<void>((resolve) => {
      root.render(TemplateEl);
      setTimeout(resolve, 300);
    });

    const fullHeight = tempDiv.scrollHeight;

    // Capture the FULL content as one canvas at high scale
    const canvas = await html2canvas(tempDiv, {
      useCORS: true,
      allowTaint: true,
      background: "#ffffff",
      logging: false,
      width: 794,
      height: fullHeight,
      ...({ scale } as object),
    });

    // ── PDF page dimensions ─────────────────────────────────────────────
    const PAGE_W_MM = 210;
    const PAGE_H_MM = 297;
    const MARGIN_MM = 8; // top & bottom margin on every page
    const CONTENT_H_MM = PAGE_H_MM - MARGIN_MM * 2; // 273mm of usable space

    // Canvas pixels per mm
    const PX_PER_MM = canvas.width / PAGE_W_MM;

    // Usable content height in canvas pixels
    const CONTENT_H_PX = CONTENT_H_MM * PX_PER_MM;

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [PAGE_W_MM, PAGE_H_MM],
    });

    let sourceY = 0; // current Y position in the source canvas
    let isFirstPage = true;

    while (sourceY < canvas.height - 2 * PX_PER_MM) { // stop if < 2px left
      if (!isFirstPage) {
        pdf.addPage([PAGE_W_MM, PAGE_H_MM], "portrait");
      }

      // How many pixels to slice from the canvas for this page
      const sliceH = Math.min(CONTENT_H_PX, canvas.height - sourceY);

      // Create a temporary canvas for just this page's slice
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceH;

      const ctx = pageCanvas.getContext("2d")!;
      // Draw the slice onto the page canvas
      ctx.drawImage(
        canvas,
        0, sourceY,           // source x, y
        canvas.width, sliceH, // source width, height
        0, 0,                 // dest x, y
        canvas.width, sliceH  // dest width, height
      );

      const pageImgData = pageCanvas.toDataURL(`image/${imageFormat.toLowerCase()}`, imageQuality);

      // Render the slice at MARGIN_MM from top, full width, proportional height
      const sliceHeightMm = (sliceH / canvas.width) * PAGE_W_MM;

      pdf.addImage(
        pageImgData,
        imageFormat,
        0,           // x: left edge
        MARGIN_MM,   // y: top margin — consistent on every page ✅
        PAGE_W_MM,   // width: full page width
        sliceHeightMm // height: proportional to slice
      );

      sourceY += sliceH;
      isFirstPage = false;
    }

    return pdf.output("blob");

  } finally {
    root.unmount();
    if (document.body.contains(tempDiv)) {
      document.body.removeChild(tempDiv);
    }
  }
}

// ─── Modal Component ──────────────────────────────────────────────────────────
export function QuotationPreviewModal({
  open,
  onClose,
  template,
  data,
  discountMode,
  shouldMarkAsSent = true,
  setCurrentStatus
}: Props) {
  const [customerEmail, setCustomerEmail] = useState(data.customerEmail ?? "");
  const [ccEmail, setCcEmail] = useState("");
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [emailSubject, setEmailSubject] = useState(
    `Quotation ${data.quotationNumber} — ${data.companyName}`
  );
  const [emailMessage, setEmailMessage] = useState(
    `Dear ${
      data.customerContact || data.customerCompanyName || "Customer"
    },\n\nPlease find quotation ${data.quotationNumber} from ${
      data.companyName
    } attached for your review.`
  );
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");

  const primaryRecipient = customerEmail.trim();
  const totalRecipientCount =
    (primaryRecipient ? 1 : 0) + ccEmails.length;

  const validateEmail = (value: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);



  // ── Email helpers ─────────────────────────────────────────────────────
  const addCcEmail = () => {
    const email = ccEmail.trim().toLowerCase();
    if (!email) return;
    if (!validateEmail(email)) {
      toast.error("Please enter a valid CC email address.");
      return;
    }
    if (
      ccEmails.includes(email) ||
      email === customerEmail.trim().toLowerCase()
    ) {
      toast.error("Email already added.");
      return;
    }
    setCcEmails((prev) => [...prev, email]);
    setCcEmail("");
  };

  const removeCcEmail = (email: string) =>
    setCcEmails((prev) => prev.filter((e) => e !== email));

  const handleSendEmail = async () => {
    const primary = customerEmail.trim();

    if (!primary) {
      toast.error("Please enter the customer email.");
      return;
    }

    if (!validateEmail(primary)) {
      toast.error("Please enter a valid customer email address.");
      return;
    }

    setSendStatus("sending");
    try {
      // Generate PDF and encode as base64 for attachment
      const pdfBlob = await generatePDFBlob(template.id, data, {
        scale: 2,
        imageFormat: "JPEG",
        imageQuality: 0.92,
      }, discountMode);
      const arrayBuffer = await pdfBlob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Pdf = btoa(binary);
      const safeName = data.quotationNumber.replace(/[\s/\\:*?"<>|]/g, "_");
      const attachment = {
        filename: `Quotation_${safeName}.pdf`,
        content: base64Pdf,
        contentType: "application/pdf",
      };

      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL || "https://yourwebsite.com";
      const quotationParam = encodeURIComponent(data.quotationNumber);
      const approveUrl = `${appUrl}/quotations/review?quotationNumber=${quotationParam}&intent=approve`;
      const rejectUrl = `${appUrl}/quotations/review?quotationNumber=${quotationParam}&intent=reject`;

      const htmlForCustomer = buildQuotationEmailHtml({
        data,
        customMessage: emailMessage,
        approveUrl,
        rejectUrl,
        includeApprovalSection: true,
      });

      // Send to primary customer with approve/reject section
      await emailService.sendEmail({
        to: primary,
        subject: emailSubject,
        html: htmlForCustomer,
        attachment,
      });

      // Send to CC recipients without approve/reject section
      if (ccEmails.length) {
        const htmlForCc = buildQuotationEmailHtml({
          data,
          customMessage: emailMessage,
          approveUrl,
          rejectUrl,
          includeApprovalSection: false,
        });

        await emailService.sendEmail({
          to: ccEmails,
          subject: emailSubject,
          html: htmlForCc,
          attachment,
        });
      }

      setSendStatus("sent");

      if (shouldMarkAsSent && data.zohoEstimateId) {
        fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/estimates/transition`, {
          method: "POST",
          body: JSON.stringify({
            record_id: data.zohoEstimateId,
            action: "mark_as_sent",
          }),
        });
        setCurrentStatus("Waiting For Approval");
      }
      
      toast.success(
        `Quotation email sent to ${primary}${
          ccEmails.length ? ` (CC: ${ccEmails.join(", ")})` : ""
        }.`
      );
    } catch (error) {
      console.error(error);
      setSendStatus("error");
      toast.error("Failed to send. Please try again.");
    }
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    // Reset send status whenever the dialog open state changes
    setSendStatus("idle");

    if (!nextOpen) {
      onClose();
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
    <DialogContent className={sendStatus === "sent" ? "sm:max-w-md" : "flex flex-col gap-0 overflow-y-visible p-0 sm:max-w-lg [&>button:last-child]:top-3.5"}>
      {
        sendStatus !== "sent" ? (
          <DialogHeader className="contents space-y-0 text-left">
            <DialogTitle className="border-b px-6 py-4 text-base flex items-center gap-2">
              <Send className="h-4 w-4 text-primary" />
              Send Quotation Email
            </DialogTitle>
          </DialogHeader>
        ): (
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="size-4 text-primary" />
              Quotation Email Sent!
            </DialogTitle>
            {/* <DialogDescription>
              Quotation email sent to {totalRecipientCount} recipient{totalRecipientCount !== 1 ? "s" : ""}.
            </DialogDescription> */}
          </DialogHeader>
        )
      }
    
      {sendStatus === "sent" ? (
            /* ── Success ── */
            <div className="space-y-4 py-2">
            {/* Status icon */}
            <div className="flex justify-center">
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle2 className="size-14 text-green-500 animate-in zoom-in-50 duration-300" />
                  <p className="font-semibold text-base">Sent Successfully!</p>
                <p className="text-sm text-muted-foreground">
                  Quotation delivered to{" "}
                  <span className="font-medium text-foreground">
                    {totalRecipientCount} recipient{totalRecipientCount !== 1 ? "s" : ""}
                  </span>
                </p>
  {/* Recipients summary badges */}
  {(primaryRecipient || ccEmails.length > 0) && (
                <div className="flex flex-wrap justify-center gap-1.5 max-w-xs animate-in fade-in-0 duration-500 delay-200">
                  {primaryRecipient && (
                    <Badge variant="secondary" className="text-xs gap-1">
                      <Mail className="size-3" />
                      {primaryRecipient}
                    </Badge>
                  )}
                  {ccEmails.map((email) => (
                    <Badge key={email} variant="outline" className="text-xs gap-1">
                      <Mail className="size-3" />
                      {email}
                    </Badge>
                  ))}
                </div>
              )}                </div>

                </div>
                <Button className="w-full" onClick={() => onClose()}>
                  <X className="size-4" />
                  Close
              </Button>

                </div>
                
          ) : (
            <div className="overflow-y-auto max-h-[85vh] px-6 pt-4 pb-6">

                  <div className="space-y-5  pb-4">
                    {/* Customer email */}
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2 text-sm">
                        <User className="size-3.5 text-primary" /> Customer Email
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="customer@example.com"
                          value={customerEmail}
                          onChange={(e) => setCustomerEmail(e.target.value)}
                          className="text-sm"
                        />
                      </div>
                      {!data.customerEmail && (
                        <p className="text-[11px] text-muted-foreground">
                          No customer email found in quotation. Please enter it
                          to send the quotation.
                        </p>
                      )}
                    </div>


                {/* CC emails */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2 text-sm">
                    <Users className="size-3.5 text-primary" /> CC Emails (optional)
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="cc@example.com"
                      value={ccEmail}
                      onChange={(e) => setCcEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addCcEmail()}
                      className="text-sm"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      onClick={addCcEmail}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                  {ccEmails.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {ccEmails.map((email) => (
                        <Badge
                          key={email}
                          variant="secondary"
                          className="gap-1 pr-1"
                        >
                          {email}
                          <button
                            type="button"
                            onClick={() => removeCcEmail(email)}
                            className="ml-1 hover:text-destructive"
                          >
                            <X className="size-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>


                    {/* Subject + Message */}
                      <div className="space-y-2">
                      <Label className="flex items-center gap-2 text-sm">
                        <Mail className="size-3.5 text-primary" /> Subject
                      </Label>                        <Input
                          value={emailSubject}
                          onChange={(e) => setEmailSubject(e.target.value)}
                          className="text-sm"
                        />
                      </div>
                      <div className="space-y-2">
                      <Label className="flex items-center gap-2 text-sm">
                        <MessageCircle className="size-3.5 text-primary" /> Customer Message (optional)
                      </Label>
                        <textarea
                          value={emailMessage}
                          onChange={(e) => setEmailMessage(e.target.value)}
                          rows={5}
                          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                    </div>

               
                  </div>
<div className="pb-4">
{primaryRecipient && (
                  <Alert>
                    <Mail className="size-4" />
                    <AlertDescription className="text-xs">
                      Sending to{" "}
                      <span className="font-medium">
                        {primaryRecipient}
                        {ccEmails.length
                          ? ` (CC: ${ccEmails.join(", ")})`
                          : ""}
                      </span>
                    </AlertDescription>
                  </Alert>
                )}

                    {sendStatus === "error" && (
                      <Alert variant="destructive">
                        <AlertDescription>
                          Failed to send. Please try again.
                        </AlertDescription>
                      </Alert>
                    )}
          </div> 

         <DialogFooter className=" -mx-6 -mb-6">
         <Button
                             type="button"
                             variant="outline"
                             onClick={() => onClose()}
                           >
                             Cancel
                           </Button>
                           <Button type="button" disabled={sendStatus === "sending"} onClick={handleSendEmail}>
                             {sendStatus === "sending" ? "Sending..." : "Send Email"}
                           </Button>
                         </DialogFooter>
            </div>
              )}
      </DialogContent>
    </Dialog>
  );
}