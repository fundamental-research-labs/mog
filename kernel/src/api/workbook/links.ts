import type { WorkbookLinks, WorkbookLinkStatusScope } from '@mog-sdk/contracts/api';
import type { WorkbookLinkService } from '../../services/workbook-links';

export class WorkbookLinksImpl implements WorkbookLinks {
  constructor(
    private readonly service: WorkbookLinkService,
    private readonly scope: () => WorkbookLinkStatusScope,
  ) {}

  list(): ReturnType<WorkbookLinks['list']> {
    return this.service.list();
  }

  get(linkId: Parameters<WorkbookLinks['get']>[0]): ReturnType<WorkbookLinks['get']> {
    return this.service.get(linkId);
  }

  add(input: Parameters<WorkbookLinks['add']>[0]): ReturnType<WorkbookLinks['add']> {
    return this.service.create(input);
  }

  create(input: Parameters<WorkbookLinks['create']>[0]): ReturnType<WorkbookLinks['create']> {
    return this.service.create(input);
  }

  retarget(
    linkId: Parameters<WorkbookLinks['retarget']>[0],
    input: Parameters<WorkbookLinks['retarget']>[1],
  ): ReturnType<WorkbookLinks['retarget']> {
    return this.service.update(linkId, input);
  }

  update(
    linkId: Parameters<WorkbookLinks['update']>[0],
    input: Parameters<WorkbookLinks['update']>[1],
  ): ReturnType<WorkbookLinks['update']> {
    return this.service.update(linkId, input);
  }

  break(
    linkId: Parameters<WorkbookLinks['break']>[0],
    options: Parameters<WorkbookLinks['break']>[1],
  ): ReturnType<WorkbookLinks['break']> {
    return this.service.break(linkId, options);
  }

  delete(linkId: Parameters<WorkbookLinks['delete']>[0]): ReturnType<WorkbookLinks['delete']> {
    return this.service.delete(linkId);
  }

  getStatus(
    linkId: Parameters<WorkbookLinks['getStatus']>[0],
  ): ReturnType<WorkbookLinks['getStatus']> {
    return this.service.getStatus(linkId, this.scope());
  }

  async refresh(
    linkId: Parameters<WorkbookLinks['refresh']>[0],
  ): ReturnType<WorkbookLinks['refresh']> {
    return (await this.service.refresh(linkId, this.scope())).statusView;
  }

  async refreshAll(
    options?: Parameters<WorkbookLinks['refreshAll']>[0],
  ): ReturnType<WorkbookLinks['refreshAll']> {
    return (await this.service.refreshAll(this.scope(), options)).statusViews;
  }

  watchStatus(
    linkId: Parameters<WorkbookLinks['watchStatus']>[0],
    handler: Parameters<WorkbookLinks['watchStatus']>[1],
  ): ReturnType<WorkbookLinks['watchStatus']> {
    return this.service.watchStatus(linkId, this.scope(), handler);
  }

  getUsages(
    linkId: Parameters<WorkbookLinks['getUsages']>[0],
  ): ReturnType<WorkbookLinks['getUsages']> {
    return this.service.getUsages(linkId);
  }

  copySource(
    linkId: Parameters<WorkbookLinks['copySource']>[0],
  ): ReturnType<WorkbookLinks['copySource']> {
    return this.service.copySource(linkId, this.scope());
  }

  listPackageDiagnostics(): ReturnType<WorkbookLinks['listPackageDiagnostics']> {
    return this.service.listPackageDiagnostics();
  }
}
