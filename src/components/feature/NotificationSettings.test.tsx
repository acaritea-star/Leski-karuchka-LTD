// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@/i18n';
const fake=vi.hoisted(()=>({user:{id:'alice',role:'CUSTOMER'},preference:true as boolean|null,enabled:false,
 permission:'granted',enabling:false,supported:true,enable:vi.fn().mockResolvedValue(true),unregister:vi.fn().mockResolvedValue(true)}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:fake.user})}));
vi.mock('@/hooks/usePushNotifications',()=>({usePushNotifications:()=>fake}));
vi.mock('@/lib/pushSubscription',()=>({getPushPreference:()=>fake.preference,pushSupported:()=>fake.supported}));
import NotificationSettings from './NotificationSettings';
import EnableNotificationsBanner from './EnableNotificationsBanner';
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();fake.user={id:'alice',role:'CUSTOMER'};fake.preference=true;
 fake.enable.mockReset().mockResolvedValue(true);
 fake.enabled=false;fake.permission='granted';fake.enabling=false;fake.supported=true;});
afterEach(cleanup);
it('keeps a saved choice on while delivery is restoring and lets the switch turn it off',async()=>{
 render(<NotificationSettings />);const toggle=screen.getByRole('switch');
 expect(toggle.getAttribute('aria-checked')).toBe('true');expect(screen.getByRole('status').textContent).toContain('Изборът ти е запазен');
 fireEvent.click(toggle);await act(async()=>{});
 expect(fake.unregister).toHaveBeenCalledWith('alice');expect(fake.enable).not.toHaveBeenCalled();
});
it.each(['denied','unsupported'])('allows an opt-out even when the browser is %s',async state=>{
 fake.permission=state==='denied'?'denied':'granted';fake.supported=state!=='unsupported';
 render(<NotificationSettings />);const toggle=screen.getByRole('switch');expect(toggle.hasAttribute('disabled')).toBe(false);
 fireEvent.click(toggle);await act(async()=>{});expect(fake.unregister).toHaveBeenCalledWith('alice');
});
it('can repair delivery from Settings without toggling off the saved choice',async()=>{
 render(<NotificationSettings />);fireEvent.click(screen.getByRole('button',{name:'Възстанови връзката'}));await act(async()=>{});
 expect(fake.enable).toHaveBeenCalledWith('alice');expect(fake.unregister).not.toHaveBeenCalled();
});
it.each([true,false])('does not re-solicit a saved %s notification decision on login',preference=>{
 fake.preference=preference;render(<MemoryRouter><EnableNotificationsBanner /></MemoryRouter>);
 expect(screen.queryByLabelText('Настройка на известията')).toBeNull();
});
it('keeps dismissal scoped to its account when a new account arrives',()=>{
 fake.preference=null;fake.permission='default';const view=render(<MemoryRouter><EnableNotificationsBanner /></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'Отказ'}));expect(screen.queryByLabelText('Настройка на известията')).toBeNull();
 fake.user={id:'bob',role:'CUSTOMER'};view.rerender(<MemoryRouter><EnableNotificationsBanner /></MemoryRouter>);
 expect(screen.getByLabelText('Настройка на известията')).toBeTruthy();
});
it('keeps a failed first registration visible after the preference is saved and allows retry',async()=>{
 fake.preference=null;fake.permission='granted';
 fake.enable.mockImplementationOnce(async()=>{fake.preference=true;return false;});
 render(<MemoryRouter><EnableNotificationsBanner /></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'Включи известия'}));await act(async()=>{});
 const retry=screen.getByRole('button',{name:'Опитай отново'});
 expect(screen.getByLabelText('Настройка на известията').textContent).toContain('Не успяхме');
 fireEvent.click(retry);await act(async()=>{});
 expect(fake.enable).toHaveBeenCalledTimes(2);
 expect(screen.queryByLabelText('Настройка на известията')).toBeNull();
});
it('keeps an attempted registration visible while the saved preference is true and the request is pending',async()=>{
 fake.preference=null;let finish!:(value:boolean)=>void;
 fake.enable.mockImplementationOnce(()=>{fake.preference=true;return new Promise<boolean>(resolve=>{finish=resolve;});});
 const view=render(<MemoryRouter><EnableNotificationsBanner /></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'Включи известия'}));
 view.rerender(<MemoryRouter><EnableNotificationsBanner /></MemoryRouter>);
 expect(screen.getByLabelText('Настройка на известията')).toBeTruthy();
 await act(async()=>{finish(false);});
 expect(screen.getByRole('button',{name:'Опитай отново'})).toBeTruthy();
});
it('does not carry a failed notification prompt into a different account',async()=>{
 fake.preference=null;fake.enable.mockImplementationOnce(async()=>{fake.preference=true;return false;});
 const view=render(<MemoryRouter><EnableNotificationsBanner /></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'Включи известия'}));await act(async()=>{});
 fake.user={id:'bob',role:'CUSTOMER'};
 view.rerender(<MemoryRouter><EnableNotificationsBanner /></MemoryRouter>);
 expect(screen.queryByLabelText('Настройка на известията')).toBeNull();
 fake.preference=null;view.rerender(<MemoryRouter><EnableNotificationsBanner /></MemoryRouter>);
 expect(screen.getByRole('button',{name:'Включи известия'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Опитай отново'})).toBeNull();
});
