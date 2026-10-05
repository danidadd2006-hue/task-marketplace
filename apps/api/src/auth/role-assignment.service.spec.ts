import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ userFirst: vi.fn(), assignmentFirst: vi.fn(), assignmentAll: vi.fn(), assignmentCreate: vi.fn(), assignmentDelete: vi.fn(), auditLog: vi.fn() }));
vi.mock('../prisma/db.js', () => ({ db: { orm: { public: { User: { where: vi.fn(() => ({ first: mocks.userFirst })) }, UserRoleAssignment: { where: vi.fn((query) => query?.role ? { first: mocks.assignmentFirst } : query?.id ? { delete: mocks.assignmentDelete } : { all: mocks.assignmentAll }), create: mocks.assignmentCreate } } } } }));
import { RoleAssignmentService } from './role-assignment.service.js';
describe('RoleAssignmentService', () => {
 const service = new RoleAssignmentService({ log: mocks.auditLog } as never);
 beforeEach(() => { vi.resetAllMocks(); mocks.userFirst.mockResolvedValue({ id: 'target-id' }); mocks.assignmentFirst.mockResolvedValue(undefined); mocks.assignmentAll.mockResolvedValue([{ id: 'client-assignment', role: 'CLIENT' }, { id: 'worker-assignment', role: 'WORKER' }]); mocks.assignmentCreate.mockResolvedValue({ id: 'assignment-id', userId: 'target-id', role: 'WORKER', assignedBy: 'admin-id' }); });
 it('supports CLIENT and WORKER assignments on one account', async () => { await service.assign('admin-id','target-id','CLIENT'); await service.assign('admin-id','target-id','WORKER'); expect(mocks.assignmentCreate).toHaveBeenNthCalledWith(1,{userId:'target-id',role:'CLIENT',assignedBy:'admin-id'}); expect(mocks.assignmentCreate).toHaveBeenNthCalledWith(2,{userId:'target-id',role:'WORKER',assignedBy:'admin-id'}); });
 it('rejects self-assignment', async () => { await expect(service.assign('same','same','WORKER')).rejects.toBeInstanceOf(BadRequestException); });
 it('rejects assignment for a missing user', async () => { mocks.userFirst.mockResolvedValue(undefined); await expect(service.assign('admin','missing','WORKER')).rejects.toBeInstanceOf(NotFoundException); });
 it('rejects duplicate role assignment', async () => { mocks.assignmentFirst.mockResolvedValue({ id:'existing', role:'WORKER' }); await expect(service.assign('admin','target-id','WORKER')).rejects.toBeInstanceOf(ConflictException); });
 it('rejects self-removal', async () => { await expect(service.remove('same','same','WORKER')).rejects.toBeInstanceOf(BadRequestException); });
 it('rejects removal of the final role', async () => { mocks.assignmentAll.mockResolvedValue([{id:'only',role:'CLIENT'}]); await expect(service.remove('admin','target-id','CLIENT')).rejects.toBeInstanceOf(BadRequestException); });
 it('removes WORKER and audits the change', async () => { await service.remove('admin','target-id','WORKER'); expect(mocks.assignmentDelete).toHaveBeenCalledWith(); expect(mocks.auditLog).toHaveBeenCalledWith('admin','DELETE','UserRoleAssignment','worker-assignment',JSON.stringify({userId:'target-id',role:'WORKER'})); });
});