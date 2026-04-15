"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { QuotationData, ServiceItemImage } from "./quotation-templates";

const MAX_IMAGES_PER_SERVICE_ITEM = 2;

function normalizeId(value: string | null | undefined): string {
  return (value ?? "").trim();
}

type Params = {
  activeData: QuotationData | null;
  setSearchResultsAction: React.Dispatch<
    React.SetStateAction<QuotationData | null>
  >;
};

export function useServiceItemImages({
  activeData,
  setSearchResultsAction,
}: Params) {
  const [selectedServiceItemId, setSelectedServiceItemId] =
    useState<string>("");
  const [selectedImageFiles, setSelectedImageFiles] = useState<File[]>([]);
  const [isUploadingServiceItemImages, setIsUploadingServiceItemImages] =
    useState(false);
  const [deletingImageUrl, setDeletingImageUrl] = useState<string | null>(null);

  const selectedServiceItemImageCount = useMemo(() => {
    if (!activeData || !selectedServiceItemId) {
      return 0;
    }
    const targetServiceItemId = normalizeId(selectedServiceItemId);
    return (activeData.serviceItemImages ?? []).filter(
      (image) => normalizeId(image.serviceItemId) === targetServiceItemId,
    ).length;
  }, [activeData, selectedServiceItemId]);

  const selectedServiceItemImages = useMemo(() => {
    if (!activeData || !selectedServiceItemId) {
      return [];
    }
    const targetServiceItemId = normalizeId(selectedServiceItemId);
    return (activeData.serviceItemImages ?? []).filter(
      (image) => normalizeId(image.serviceItemId) === targetServiceItemId,
    );
  }, [activeData, selectedServiceItemId]);

  const remainingImageSlots = Math.max(
    0,
    MAX_IMAGES_PER_SERVICE_ITEM - selectedServiceItemImageCount,
  );
  const selectedImageCount = selectedImageFiles.length;
  const remainingAfterSelection = Math.max(
    0,
    MAX_IMAGES_PER_SERVICE_ITEM -
      (selectedServiceItemImageCount + selectedImageCount),
  );

  const selectedImagePreviews = useMemo(
    () =>
      selectedImageFiles.map((file) => ({
        key: `${file.name}-${file.size}-${file.lastModified}`,
        name: file.name,
        url: URL.createObjectURL(file),
      })),
    [selectedImageFiles],
  );

  useEffect(() => {
    return () => {
      selectedImagePreviews.forEach((preview) => {
        URL.revokeObjectURL(preview.url);
      });
    };
  }, [selectedImagePreviews]);

  const onSelectServiceItem = (value: string) => {
    setSelectedServiceItemId(value);
    setSelectedImageFiles([]);
  };

  const handleImageFilesChange: React.ChangeEventHandler<HTMLInputElement> = (
    event,
  ) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    const acceptedFiles = files.filter((file) =>
      file.type.startsWith("image/"),
    );
    if (acceptedFiles.length !== files.length) {
      toast.error("Only image files are allowed.");
    }

    setSelectedImageFiles((prev) => {
      const existingKeys = new Set(
        prev.map((file) => `${file.name}-${file.size}-${file.lastModified}`),
      );
      const uniqueNewFiles = acceptedFiles.filter((file) => {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        return !existingKeys.has(key);
      });
      return [...prev, ...uniqueNewFiles].slice(0, MAX_IMAGES_PER_SERVICE_ITEM);
    });

    // Keep picker usable for reselecting same file if needed.
    event.currentTarget.value = "";
  };

  const handleRemoveSelectedImage = (previewKey: string) => {
    setSelectedImageFiles((prev) =>
      prev.filter(
        (file) =>
          `${file.name}-${file.size}-${file.lastModified}` !== previewKey,
      ),
    );
  };

  const handleAttachImages = async (): Promise<boolean> => {
    if (!activeData?.zohoEstimateId || !activeData?.quotationNumber) {
      toast.error("Quotation info is missing. Please search again.");
      return false;
    }
    if (!selectedServiceItemId) {
      toast.error("Please select a service item.");
      return false;
    }
    if (selectedImageFiles.length === 0) {
      toast.error("Please select at least one image.");
      return false;
    }
    if (selectedImageFiles.length > remainingImageSlots) {
      toast.error(
        `Only ${remainingImageSlots} image slot(s) left for this service item.`,
      );
      return false;
    }

    setIsUploadingServiceItemImages(true);
    try {
      const formData = new FormData();
      formData.append("quotationId", activeData.zohoEstimateId);
      formData.append("quotationName", activeData.quotationNumber);
      formData.append("serviceItemId", selectedServiceItemId);
      for (const file of selectedImageFiles) {
        formData.append("images", file);
      }

      const response = await fetch("/api/estimates/service-item-images", {
        method: "POST",
        body: formData,
      });
      const json: {
        success: boolean;
        error?: string;
        images?: ServiceItemImage[];
      } = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error ?? "Failed to upload images.");
      }

      if (json.images && json.images.length > 0) {
        setSearchResultsAction((prev) => {
          if (!prev) {
            return prev;
          }
          const existing = prev.serviceItemImages ?? [];
          const dedupedNew = json.images!.filter(
            (image) =>
              !existing.some((row) => row.supabaseUrl === image.supabaseUrl),
          );
          return {
            ...prev,
            serviceItemImages: [...existing, ...dedupedNew],
          };
        });
      }

      toast.success("Images attached successfully.");
      setSelectedImageFiles([]);
      return true;
    } catch (error) {
      console.error("Attach images error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to attach images.",
      );
      return false;
    } finally {
      setIsUploadingServiceItemImages(false);
    }
  };

  const handleDeleteServiceItemImage = async (imageUrl: string) => {
    if (!activeData?.zohoEstimateId || !selectedServiceItemId) {
      toast.error("Missing quotation or service item data.");
      return;
    }

    setDeletingImageUrl(imageUrl);
    try {
      const response = await fetch("/api/estimates/service-item-images", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quotationId: activeData.zohoEstimateId,
          serviceItemId: selectedServiceItemId,
          supabaseUrl: imageUrl,
        }),
      });

      const json: { success: boolean; error?: string } = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error ?? "Failed to delete image.");
      }

      setSearchResultsAction((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          serviceItemImages: (prev.serviceItemImages ?? []).filter(
            (image) => image.supabaseUrl !== imageUrl,
          ),
        };
      });

      toast.success("Image removed.");
    } catch (error) {
      console.error("Delete image error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to remove image.",
      );
    } finally {
      setDeletingImageUrl(null);
    }
  };

  const resetAttachImagesState = () => {
    console.log("resetAttachImagesState");
    setSelectedServiceItemId("");
    setSelectedImageFiles([]);
    setDeletingImageUrl(null);
  };

  return {
    selectedServiceItemId,
    selectedImageFiles,
    isUploadingServiceItemImages,
    deletingImageUrl,
    selectedServiceItemImages,
    remainingAfterSelection,
    selectedImagePreviews,
    onSelectServiceItem,
    handleImageFilesChange,
    handleRemoveSelectedImage,
    handleAttachImages,
    handleDeleteServiceItemImage,
    resetAttachImagesState,
  };
}
