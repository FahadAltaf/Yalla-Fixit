// Define type for pixel crop area
export type Area = { x: number; y: number; width: number; height: number }

// Helper function to optimize image size while maintaining quality
export async function getOptimalImageBlob(
  imageSrc: string,
  pixelCrop: Area,
  targetSizeKB: number = 200, // Target size in KB
  maxDimension: number = 400
): Promise<Blob | null> {
  const qualityLevels = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];
  
  for (const quality of qualityLevels) {
    const blob = await getCroppedImg(
      imageSrc,
      pixelCrop,
      Math.min(pixelCrop.width, maxDimension),
      Math.min(pixelCrop.height, maxDimension),
      'image/jpeg',
      quality
    );
    
    if (blob && blob.size <= targetSizeKB * 1024) {
      return blob;
    }
  }
  
  // If we still can't get under target size, return the smallest we can make
  return getCroppedImg(
    imageSrc,
    pixelCrop,
    Math.min(pixelCrop.width, maxDimension),
    Math.min(pixelCrop.height, maxDimension),
    'image/jpeg',
    0.3
  );
}

// Helper function to create a cropped image
export const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener("load", () => resolve(image))
    image.addEventListener("error", (error: Event) => reject(error))
    image.setAttribute("crossOrigin", "anonymous")
    image.src = url
  })

export async function getCroppedImg(
  imageSrc: string,
  pixelCrop: Area,
  outputWidth: number = pixelCrop.width,
  outputHeight: number = pixelCrop.height,
  outputFormat: 'image/jpeg' | 'image/png' = 'image/jpeg',
  quality: number = 0.8
): Promise<Blob | null> {
  try {
    const image = await createImage(imageSrc)
    const canvas = document.createElement("canvas")
    
    // Get context with alpha channel explicitly enabled
    const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: true })

    if (!ctx) {
      return null
    }

    // Set canvas dimensions to the specified output size
    canvas.width = outputWidth
    canvas.height = outputHeight

    // For JPEG, fill with white background to avoid transparency issues
    if (outputFormat === 'image/jpeg') {
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    } else {
      // Ensure the canvas is fully transparent before drawing for PNG
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
    
    // Set compositing mode for proper transparency handling
    ctx.globalCompositeOperation = 'source-over'

    // Enable image smoothing for better quality when resizing
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    // Draw the image
    ctx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      outputWidth,
      outputHeight
    )

    // Use the specified format and quality
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob)
      }, outputFormat, quality)
    })
  } catch (error) {
    console.error("Error in getCroppedImg:", error)
    return null
  }
} 