/**
 * 图片下载工具函数
 * 统一处理 Bug 和需求的图片下载逻辑
 */
/**
 * 检测图片 MIME 类型
 */
function detectMimeType(buffer) {
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
        return 'image/jpeg';
    }
    else if (buffer[0] === 0x47 && buffer[1] === 0x49) {
        return 'image/gif';
    }
    else if (buffer[0] === 0x89 && buffer[1] === 0x50) {
        return 'image/png';
    }
    return 'image/png'; // 默认
}
/**
 * 带超时的图片下载
 * @param zentaoApi Zentao API 实例
 * @param url 图片 URL
 * @param timeoutMs 超时时间（毫秒），默认 15 秒
 * @returns 下载结果
 */
async function downloadImageWithTimeout(zentaoApi, url, timeoutMs = 15000) {
    const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => {
            resolve({
                url,
                success: false,
                error: `下载超时（${timeoutMs}ms）`
            });
        }, timeoutMs);
    });
    const downloadPromise = (async () => {
        try {
            const imageBuffer = await zentaoApi.downloadStoryImage(url);
            const base64Image = imageBuffer.toString('base64');
            const mimeType = detectMimeType(imageBuffer);
            return {
                url,
                base64: base64Image,
                mimeType,
                size: imageBuffer.length,
                success: true
            };
        }
        catch (error) {
            return {
                url,
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    })();
    // 使用 Promise.race 实现超时控制
    return Promise.race([downloadPromise, timeoutPromise]);
}
/**
 * 下载图片列表
 * @param zentaoApi Zentao API 实例
 * @param imageUrls 图片 URL 列表
 * @param parallel 是否并行下载（默认 true）
 * @param timeoutMs 单张图片超时时间（毫秒），默认 15 秒
 * @returns 下载结果数组
 */
export async function downloadImages(zentaoApi, imageUrls, parallel = true, timeoutMs = 15000) {
    if (imageUrls.length === 0) {
        return [];
    }
    if (parallel) {
        // 并行下载，使用 Promise.allSettled 确保即使部分失败也能继续
        const downloadPromises = imageUrls.map(url => downloadImageWithTimeout(zentaoApi, url, timeoutMs));
        // 使用 allSettled 而不是 all，这样即使部分图片超时/失败，也能返回已成功的图片
        const results = await Promise.allSettled(downloadPromises);
        return results.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            }
            else {
                return {
                    url: imageUrls[index],
                    success: false,
                    error: result.reason instanceof Error ? result.reason.message : String(result.reason)
                };
            }
        });
    }
    else {
        // 串行下载（兼容旧逻辑），但添加超时控制
        const results = [];
        for (const url of imageUrls) {
            const result = await downloadImageWithTimeout(zentaoApi, url, timeoutMs);
            results.push(result);
            // 即使失败也继续下载下一张
        }
        return results;
    }
}
/**
 * 构建 MCP image 内容数组
 * 注意：不包含原始 URL，避免 Cursor 循环读取
 */
export function buildImageContent(downloadedImages, entityType, entityId) {
    const content = [];
    downloadedImages.forEach((img, index) => {
        if (img.success && img.base64) {
            content.push({
                type: "image",
                data: img.base64,
                mimeType: img.mimeType || 'image/png',
                // 不包含 URL 信息，避免 Cursor 尝试读取原始 URL 导致循环
                // 图片已通过 base64 内嵌，无需额外 URL
            });
        }
    });
    return content;
}
