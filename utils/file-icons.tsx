import {
    FileText,
    FileImage,
    FileVideo,
    FileAudio,
    FileSpreadsheet,
    File,
    FileType,
    FileArchive,
    FileCode,
    Presentation,
    BookOpen,
    Download,
    FileX,
    LucideIcon,
  } from "lucide-react";
  import { ReactElement } from "react";
  
  // Document type to icon mapping
  const documentTypeIcons: Record<string, LucideIcon> = {
    // Text/Document files
    pdf: FileText,
    doc: FileText,
    docx: FileText,
    txt: FileText,
    rtf: FileText,
    odt: FileText,
  
    // Spreadsheets
    xls: FileSpreadsheet,
    xlsx: FileSpreadsheet,
    csv: FileSpreadsheet,
    ods: FileSpreadsheet,
  
    // Presentations
    ppt: Presentation,
    pptx: Presentation,
    odp: Presentation,
    key: Presentation,
  
    // Images
    jpg: FileImage,
    jpeg: FileImage,
    png: FileImage,
    gif: FileImage,
    svg: FileImage,
    webp: FileImage,
    bmp: FileImage,
    tiff: FileImage,
    ico: FileImage,
  
    // Videos
    mp4: FileVideo,
    avi: FileVideo,
    mkv: FileVideo,
    mov: FileVideo,
    wmv: FileVideo,
    flv: FileVideo,
    webm: FileVideo,
    "3gp": FileVideo,
  
    // Audio
    mp3: FileAudio,
    wav: FileAudio,
    flac: FileAudio,
    aac: FileAudio,
    ogg: FileAudio,
    wma: FileAudio,
    m4a: FileAudio,
  
    // Code files
    js: FileCode,
    jsx: FileCode,
    ts: FileCode,
    tsx: FileCode,
    html: FileCode,
    css: FileCode,
    scss: FileCode,
    less: FileCode,
    py: FileCode,
    java: FileCode,
    cpp: FileCode,
    c: FileCode,
    php: FileCode,
    rb: FileCode,
    go: FileCode,
    rs: FileCode,
    swift: FileCode,
    kt: FileCode,
    dart: FileCode,
    vue: FileCode,
    svelte: FileCode,
    json: FileCode,
    xml: FileCode,
    yaml: FileCode,
    yml: FileCode,
    sql: FileCode,
    sh: FileCode,
    bat: FileCode,
    ps1: FileCode,
  
    // Archives
    zip: FileArchive,
    rar: FileArchive,
    "7z": FileArchive,
    tar: FileArchive,
    gz: FileArchive,
    bz2: FileArchive,
    xz: FileArchive,
  
    // Special formats
    epub: BookOpen,
    mobi: BookOpen,
    azw: BookOpen,
    fb2: BookOpen,
  };
  
  // Color mapping for different file types
  const documentTypeColors: Record<string, string> = {
    // Text/Document files - Blue tones
    pdf: "text-red-600",
    doc: "text-blue-600",
    docx: "text-blue-600",
    txt: "text-gray-600",
    rtf: "text-blue-500",
    odt: "text-blue-500",
  
    // Spreadsheets - Green tones
    xls: "text-green-600",
    xlsx: "text-green-600",
    csv: "text-green-500",
    ods: "text-green-500",
  
    // Presentations - Orange tones
    ppt: "text-orange-600",
    pptx: "text-orange-600",
    odp: "text-orange-500",
    key: "text-orange-500",
  
    // Images - Purple tones
    jpg: "text-purple-600",
    jpeg: "text-purple-600",
    png: "text-purple-600",
    gif: "text-purple-500",
    svg: "text-purple-500",
    webp: "text-purple-500",
    bmp: "text-purple-400",
    tiff: "text-purple-400",
    ico: "text-purple-400",
  
    // Videos - Red tones
    mp4: "text-red-600",
    avi: "text-red-500",
    mkv: "text-red-500",
    mov: "text-red-500",
    wmv: "text-red-400",
    flv: "text-red-400",
    webm: "text-red-400",
    "3gp": "text-red-400",
  
    // Audio - Pink tones
    mp3: "text-pink-600",
    wav: "text-pink-500",
    flac: "text-pink-500",
    aac: "text-pink-400",
    ogg: "text-pink-400",
    wma: "text-pink-400",
    m4a: "text-pink-400",
  
    // Code files - Emerald tones
    js: "text-yellow-500",
    jsx: "text-yellow-500",
    ts: "text-blue-500",
    tsx: "text-blue-500",
    html: "text-orange-500",
    css: "text-blue-400",
    scss: "text-pink-400",
    less: "text-blue-400",
    py: "text-green-500",
    java: "text-red-500",
    cpp: "text-blue-500",
    c: "text-blue-600",
    php: "text-purple-500",
    rb: "text-red-500",
    go: "text-cyan-500",
    rs: "text-orange-600",
    swift: "text-orange-500",
    kt: "text-purple-500",
    dart: "text-blue-400",
    vue: "text-green-500",
    svelte: "text-orange-500",
    json: "text-yellow-600",
    xml: "text-orange-400",
    yaml: "text-purple-400",
    yml: "text-purple-400",
    sql: "text-blue-500",
    sh: "text-green-400",
    bat: "text-gray-500",
    ps1: "text-blue-400",
  
    // Archives - Gray tones
    zip: "text-gray-600",
    rar: "text-gray-600",
    "7z": "text-gray-600",
    tar: "text-gray-500",
    gz: "text-gray-500",
    bz2: "text-gray-500",
    xz: "text-gray-500",
  
    // Special formats - Indigo tones
    epub: "text-indigo-600",
    mobi: "text-indigo-500",
    azw: "text-indigo-500",
    fb2: "text-indigo-400",
  };
  
  /**
   * Gets the appropriate icon component for a given file type/extension
   * @param {string} fileType - The file extension (without dot) or file type
   * @param {string} className - Additional CSS classes for the icon
   * @returns {JSX.Element} The appropriate icon component
   */
  export const getDocumentIcon = (
    fileType: string | undefined | null,
    className = "h-5 w-5"
  ): ReactElement => {
    if (!fileType) {
      return <File className={className} />;
    }
  
    // Normalize the file type (remove dot if present, convert to lowercase)
    const normalizedType = fileType.replace(/^\./, "").toLowerCase();
  
    // Get the icon component
    // Handle MIME types like "image/png" by extracting the extension
    let fileExtension = normalizedType;
    if (normalizedType.includes("/")) {
      fileExtension = normalizedType.split("/")[1];
    }
    const IconComponent = documentTypeIcons[fileExtension] || File;
  
    // Get the color class
    const colorClass = documentTypeColors[fileExtension] || "text-gray-500";
  
    // Combine className with color
    const finalClassName = `${className} ${colorClass}`;
  
    return <IconComponent className={finalClassName} />;
  };
  
  /**
   * Gets just the color class for a file type (useful for backgrounds)
   * @param {string} fileType - The file extension or file type
   * @returns {string} The color class
   */
  export const getDocumentColor = (
    fileType: string | undefined | null
  ): string => {
    if (!fileType) return "text-gray-500";
  
    const normalizedType = fileType.replace(/^\./, "").toLowerCase();
    return documentTypeColors[normalizedType] || "text-gray-500";
  };
  
  /**
   * Gets the background color variant for a file type
   * @param {string} fileType - The file extension or file type
   * @returns {string} The background color class
   */
  export const getDocumentBackgroundColor = (
    fileType: string | undefined | null
  ): string => {
    if (!fileType) return "bg-gray-100";
  
    const normalizedType = fileType.replace(/^\./, "").toLowerCase();
    const colorMap: Record<string, string> = {
      // Text/Document files
      pdf: "bg-red-50",
      doc: "bg-blue-50",
      docx: "bg-blue-50",
      txt: "bg-gray-50",
  
      // Spreadsheets
      xls: "bg-green-50",
      xlsx: "bg-green-50",
      csv: "bg-green-50",
  
      // Presentations
      ppt: "bg-orange-50",
      pptx: "bg-orange-50",
  
      // Images
      jpg: "bg-purple-50",
      jpeg: "bg-purple-50",
      png: "bg-purple-50",
      gif: "bg-purple-50",
      svg: "bg-purple-50",
  
      // Videos
      mp4: "bg-red-50",
      avi: "bg-red-50",
      mkv: "bg-red-50",
  
      // Audio
      mp3: "bg-pink-50",
      wav: "bg-pink-50",
  
      // Code files
      js: "bg-yellow-50",
      jsx: "bg-yellow-50",
      ts: "bg-blue-50",
      tsx: "bg-blue-50",
      html: "bg-orange-50",
      css: "bg-blue-50",
      py: "bg-green-50",
      java: "bg-red-50",
  
      // Archives
      zip: "bg-gray-50",
      rar: "bg-gray-50",
  
      // Books
      epub: "bg-indigo-50",
      // Removed duplicate pdf entry
    };
  
    return colorMap[normalizedType] || "bg-gray-50";
  };
  
  type SizeType = "sm" | "md" | "lg" | "xl";
  
  interface DocumentIconProps {
    fileType: string | undefined | null;
    className?: string;
    showBackground?: boolean;
    size?: SizeType;
  }
  
  /**
   * Component that renders a document icon with appropriate styling
   * @param {Object} props
   * @param {string} props.fileType - File type/extension
   * @param {string} props.className - Additional classes for the icon
   * @param {boolean} props.showBackground - Whether to show colored background
   * @param {string} props.size - Size variant ('sm', 'md', 'lg')
   */
  export const DocumentIcon = ({
    fileType,
    className = "",
    showBackground = false,
    size = "md",
  }: DocumentIconProps): ReactElement => {
    const sizeClasses: Record<SizeType, string> = {
      sm: "h-4 w-4",
      md: "h-5 w-5",
      lg: "h-6 w-6",
      xl: "h-8 w-8",
    };
  
    const iconClassName = `${sizeClasses[size]} ${className}`;
    const icon = getDocumentIcon(fileType, iconClassName);
  
    if (showBackground) {
      const bgColor = getDocumentBackgroundColor(fileType);
      const containerSizes: Record<SizeType, string> = {
        sm: "w-8 h-8",
        md: "w-10 h-10",
        lg: "w-12 h-12",
        xl: "w-16 h-16",
      };
  
      return (
        <div
          className={`${containerSizes[size]} ${bgColor} rounded-lg flex items-center justify-center`}
        >
          {icon}
        </div>
      );
    }
  
    return icon;
  };
  