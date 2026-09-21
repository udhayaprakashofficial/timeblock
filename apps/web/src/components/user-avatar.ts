const EVENT = 'tb.avatar.changed';

export function avatarKey(userId: string) {
  return `tb.avatar.${userId}`;
}

export function readAvatar(userId: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(avatarKey(userId));
  } catch {
    return null;
  }
}

export function writeAvatar(userId: string, dataUrl: string | null) {
  try {
    if (dataUrl) localStorage.setItem(avatarKey(userId), dataUrl);
    else localStorage.removeItem(avatarKey(userId));
  } catch {
    /* quota */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function onAvatarChange(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

/** Shrink a picked photo so it fits in local storage. */
export function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that photo'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not prepare that photo'));
          return;
        }
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error('That file is not an image'));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
