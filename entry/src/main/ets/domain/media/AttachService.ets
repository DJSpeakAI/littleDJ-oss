// @提供 AttachService（M4.5 附件：选图→base64 dataURL） @依赖 -
// M4.5 task361：图选→parts {type:file,mime,filename,url:dataURL}
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';

export class AttachService {
  /** 选一张图（系统相册）→dataURL；取消/失败返回空串 */
  static pickImage(): Promise<string> {
    return new Promise<string>((resolve) => {
      try {
        const picker = new photoAccessHelper.PhotoViewPicker();
        picker.select({ MIMEType: photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE, maxSelectNumber: 1 }).then((rs) => {
          if (rs.photoUris.length < 1) {
            resolve('');
            return;
          }
          const uri = rs.photoUris[0];
          const file = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
          const stat = fileIo.statSync(file.fd);
          const buf = new ArrayBuffer(stat.size);
          fileIo.readSync(file.fd, buf);
          fileIo.closeSync(file);
          const u8 = new Uint8Array(buf);
          const b64 = new util.Base64Helper().encodeToStringSync(u8);
          // uri 后缀→mime（jpg 默认）
          const lower = uri.toLowerCase();
          const mime = lower.endsWith('.png') ? 'image/png' : (lower.endsWith('.gif') ? 'image/gif' : (lower.endsWith('.webp') ? 'image/webp' : 'image/jpeg'));
          const name = lower.split('/').pop() || 'image.jpg';
          const payload: Record<string, string> = { 'mime': mime, 'name': name, 'url': 'data:' + mime + ';base64,' + b64 };
          resolve(JSON.stringify(payload));
        }).catch(() => {
          resolve('');
        });
      } catch (e) {
        resolve('');
      }
    });
  }
}
