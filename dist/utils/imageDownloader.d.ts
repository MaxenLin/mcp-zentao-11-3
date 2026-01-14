/**
 * 图片下载工具函数
 * 统一处理 Bug 和需求的图片下载逻辑
 */
import { ZentaoLegacyAPI } from '../zentaoLegacyApi.js';
export interface DownloadedImage {
    url: string;
    base64?: string;
    mimeType?: string;
    size?: number;
    success: boolean;
    error?: string;
}
/**
 * 下载图片列表
 * @param zentaoApi Zentao API 实例
 * @param imageUrls 图片 URL 列表
 * @param parallel 是否并行下载（默认 true）
 * @param timeoutMs 单张图片超时时间（毫秒），默认 15 秒
 * @returns 下载结果数组
 */
export declare function downloadImages(zentaoApi: ZentaoLegacyAPI, imageUrls: string[], parallel?: boolean, timeoutMs?: number): Promise<DownloadedImage[]>;
/**
 * 构建 MCP image 内容数组
 * 注意：不包含原始 URL，避免 Cursor 循环读取
 */
export declare function buildImageContent(downloadedImages: DownloadedImage[], entityType: 'bug' | 'story', entityId: number): any[];
/**
 * 保存图片到本地文件系统
 * @param downloadedImages 已下载的图片数组
 * @param exportDir 导出目录
 * @param entityType 实体类型（story/bug）
 * @param entityId 实体ID
 * @returns 保存结果数组，包含本地路径信息
 */
export interface SavedImage {
    originalUrl: string;
    localPath: string;
    relativePath: string;
    success: boolean;
    error?: string;
}
export declare function saveImagesToDisk(downloadedImages: DownloadedImage[], exportDir: string, entityType: 'story' | 'bug', entityId: number): Promise<SavedImage[]>;
