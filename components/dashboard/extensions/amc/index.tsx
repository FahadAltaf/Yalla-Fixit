"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  Check,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  MoreVertical,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import {
  getDefaultFormValues,
  getServicesForUnitType,
} from "./amc-constants";
import { generateAmcPDFBlob } from "./amc-pdf-utils";
import { computeAmcData } from "./amc-pricing";
import { amcFormSchema, type AmcFormData } from "./amc-types";
import { CustomerStep } from "./steps/customer-step";
import { PackageStep } from "./steps/package-step";
import { PropertyStep } from "./steps/property-step";
import { ReviewStep } from "./steps/review-step";
import { ServicesStep } from "./steps/services-step";

const STEPS = [
  { id: 1, title: "Property", description: "Property type and location" },
  { id: 2, title: "Package", description: "Select AMC package or rate" },
  { id: 3, title: "Services", description: "Select contract scope services" },
  { id: 4, title: "Customer", description: "Client and contract details" },
  { id: 5, title: "Review", description: "Summary and PDF download" },
] as const;

const STEP_FIELDS: Partial<Record<number, (keyof AmcFormData)[]>> = {
  1: ["propertyCategory", "unitType", "propertyAddress", "propertyDetail"],
  2: ["packageId", "customMonthlyPrice"],
  3: ["selectedServices", "serviceFrequencies"],
  4: [
    "customerName",
    "customerPhone",
    "customerEmail",
    "startDate",
    "paymentTerms",
    "proposalNumber",
    "coordinationContacts",
  ],
};

export function AmcContractsPage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const toastId = "dashboard-amc-download-pdf";

  const defaultValues = useMemo(() => getDefaultFormValues(), []);

  const form = useForm<AmcFormData>({
    resolver: zodResolver(amcFormSchema) as never,
    defaultValues,
    mode: "onChange",
  });

  const unitType = form.watch("unitType");
  const watchedValues = form.watch();
  const computed = useMemo(
    () => computeAmcData(watchedValues),
    [watchedValues]
  );

  useEffect(() => {
    const allowedIds = new Set(
      getServicesForUnitType(unitType).map((service) => service.id)
    );
    const current = form.getValues("selectedServices");
    const filtered = current.filter((id) => allowedIds.has(id));
    if (filtered.length !== current.length) {
      form.setValue("selectedServices", filtered, { shouldValidate: true });
      const frequencies = form.getValues("serviceFrequencies") ?? {};
      const nextFrequencies = Object.fromEntries(
        filtered.map((id) => [id, frequencies[id] ?? ""])
      );
      form.setValue("serviceFrequencies", nextFrequencies, {
        shouldValidate: true,
      });
    }
  }, [unitType, form]);

  const handleNext = async () => {
    const fields = STEP_FIELDS[currentStep] ?? [];
    const isValid =
      fields.length === 0 ? true : await form.trigger(fields);

    if (!isValid) return;

    setCurrentStep((step) => Math.min(step + 1, STEPS.length));
  };

  const handleBack = () => {
    setCurrentStep((step) => Math.max(step - 1, 1));
  };

  const handleStepClick = async (stepId: number) => {
    if (stepId >= currentStep) return;
    setCurrentStep(stepId);
  };

  const handleDownloadPDF = async () => {
    const isValid = await form.trigger();
    if (!isValid) {
      toast.error("Please complete all required fields before downloading.");
      return;
    }

    setIsGenerating(true);
    toast.loading("Generating PDF...", { id: toastId });

    try {
      const values = form.getValues();
      const pdfData = computeAmcData(values);
      const blob = await generateAmcPDFBlob(pdfData, {
        scale: 2,
        imageFormat: "JPEG",
        imageQuality: 0.92,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const safeName = values.proposalNumber.replace(/[\s/\\:*?"<>|]/g, "_");
      anchor.download = `AMC_${safeName}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("PDF downloaded successfully!");
    } catch (error) {
      console.error(error);
      toast.error("Failed to generate PDF. Please try again.");
    } finally {
      setIsGenerating(false);
      toast.dismiss(toastId);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <PropertyStep form={form} />;
      case 2:
        return <PackageStep form={form} />;
      case 3:
        return <ServicesStep form={form} />;
      case 4:
        return <CustomerStep form={form} />;
      case 5:
        return <ReviewStep form={form} computed={computed} />;
      default:
        return null;
    }
  };

  const activeStep = STEPS[currentStep - 1];
  const isReviewStep = currentStep === STEPS.length;

  return (
    <Card className="w-full flex-1 relative top-px right-px gap-6">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-xl flex items-center gap-2">
            <Wrench className="size-5 text-primary" />
            AMC Proposals
          </CardTitle>
          <CardDescription>
            Build annual maintenance contract proposals and download a generated
            PDF with only the selected services included.
          </CardDescription>
        </div>

        {isReviewStep && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="shrink-0">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
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
        )}
      </CardHeader>

      <CardContent className="space-y-5">
        {/* <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-lg border border-primary/20">
          <FileText className="size-5 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">
              {computed.packageTitle}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {watchedValues.customerName || "No customer yet"}
              {watchedValues.proposalNumber
                ? ` · ${watchedValues.proposalNumber}`
                : ""}
            </p>
          </div>
          <Badge variant="default" className="ml-auto shrink-0">
            AED {computed.totals.grandTotal.toFixed(2)}
          </Badge>
        </div> */}

        <div className="flex flex-wrap gap-2">
          {STEPS.map((step) => {
            const isActive = step.id === currentStep;
            const isComplete = step.id < currentStep;

            return (
              <button
                key={step.id}
                type="button"
                disabled={step.id > currentStep}
                onClick={() => void handleStepClick(step.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors",
                  isActive &&
                  "border-primary bg-primary/10 text-primary font-medium",
                  isComplete &&
                  "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 cursor-pointer",
                  !isActive &&
                  !isComplete &&
                  "border-border text-muted-foreground opacity-70 cursor-default"
                )}
              >
                {isComplete ? (
                  <Check className="size-3 shrink-0" />
                ) : (
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium">
                    {step.id}
                  </span>
                )}
                {step.title}
              </button>
            );
          })}
        </div>

        {/* <Card className="border-dashed"> */}
        {/* <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {activeStep.title}
              <ChevronRight className="size-4 text-muted-foreground" />
              <span className="text-sm font-normal text-muted-foreground">
                Step {currentStep} of {STEPS.length}
              </span>
            </CardTitle>
            <CardDescription>{activeStep.description}</CardDescription>
          </CardHeader> */}
        <CardContent className="px-0">
          <Form {...form}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (isReviewStep) {
                  void handleDownloadPDF();
                } else {
                  void handleNext();
                }
              }}
              className="space-y-6"
            >
              {renderStep()}

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBack}
                  disabled={currentStep === 1}
                  className="w-full sm:w-auto"
                >
                  Back
                </Button>

                {!isReviewStep ? (
                  <Button type="submit" className="w-full sm:w-auto min-w-[110px]">
                    Continue
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={handleDownloadPDF}
                    disabled={isGenerating}
                    className="w-full sm:w-auto min-w-[140px] gap-2"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Generating…
                      </>
                    ) : (
                      <>
                        <Download className="size-4" />
                        Download PDF
                      </>
                    )}
                  </Button>
                )}
              </div>
            </form>
          </Form>
        </CardContent>
        {/* </Card> */}
      </CardContent>
    </Card>
  );
}
