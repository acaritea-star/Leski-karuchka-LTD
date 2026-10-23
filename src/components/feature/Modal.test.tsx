// @vitest-environment jsdom
import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import Modal from './Modal';
afterEach(cleanup);
it('keeps prepared content mounted without taking focus or locking scroll until opened',()=>{
 const close=vi.fn();const props={onClose:close,label:'Payment',allowExternalOverlays:true};
 const view=render(<Modal {...props} open={false}><input aria-label="Prepared field"/></Modal>);
 const input=document.querySelector('input');expect(screen.queryByRole('dialog')).toBeNull();expect(document.body.style.overflow).not.toBe('hidden');expect(document.activeElement).not.toBe(input);
 view.rerender(<Modal {...props} open><input aria-label="Prepared field"/></Modal>);
 expect(screen.getByRole('dialog')).toBeTruthy();expect(screen.getByLabelText('Prepared field')).toBe(input);expect(document.body.style.overflow).toBe('hidden');
 view.rerender(<Modal {...props} open={false}><input aria-label="Prepared field"/></Modal>);
 expect(screen.queryByRole('dialog')).toBeNull();expect(document.querySelector('input')).toBe(input);expect(document.body.style.overflow).not.toBe('hidden');
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));expect(close).not.toHaveBeenCalled();
});
