let holders = 0;
let previous = '';

/** Menus and dialogs can overlap; closing one must not unlock another. */
export function lockBodyScroll() {
  if (holders++ === 0) {
    previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--holders === 0) document.body.style.overflow = previous;
  };
}
