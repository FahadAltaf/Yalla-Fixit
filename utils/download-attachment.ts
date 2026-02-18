import { toast } from "sonner";

export async function downloadAttachment(recordId: string, filename: string) {
try {
      const url = `/api/attachments/download?record_id=${encodeURIComponent(
        recordId
      )}&type=${encodeURIComponent(filename)}`;
      const res = await fetch(url);
      if (!res.ok) {
        let message = `Download failed (${res.status})`;
        try {
          const err = await res.json();
          if (err?.error) message = err.error;
        } catch {}
        throw new Error(message);
      }
      const blob = await res.blob();
      const link = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
} catch (error) {
    console.error(error);
    toast.error(error instanceof Error ? error.message : "Download failed");
}
}


