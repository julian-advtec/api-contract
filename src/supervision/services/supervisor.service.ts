import { Injectable } from '@nestjs/common';

// Importar servicios especializados
import { SupervisorDocumentosService } from './supervisor-documentos.service';
import { SupervisorRevisionService } from './supervisor-revision.service';
import { SupervisorArchivosService } from './supervisor-archivos.service';
import { SupervisorEstadisticasService } from './supervisor-estadisticas.service';

@Injectable()
export class SupervisorService {
  constructor(
    private readonly documentosService: SupervisorDocumentosService,
    private readonly revisionService: SupervisorRevisionService,
    private readonly archivosService: SupervisorArchivosService,
    private readonly estadisticasService: SupervisorEstadisticasService,
  ) {}

  // Delegate methods to specialized services

  // Documentos
  obtenerDocumentosDisponibles(supervisorId: string) {
    return this.documentosService.obtenerDocumentosDisponibles(supervisorId);
  }

  tomarDocumentoParaRevision(documentoId: string, supervisorId: string) {
    return this.documentosService.tomarDocumentoParaRevision(documentoId, supervisorId);
  }

  obtenerDocumentosEnRevision(supervisorId: string) {
    return this.documentosService.obtenerDocumentosEnRevision(supervisorId);
  }

  liberarDocumento(documentoId: string, supervisorId: string) {
    return this.documentosService.liberarDocumento(documentoId, supervisorId);
  }

  obtenerDetalleDocumento(documentoId: string, supervisorId: string) {
    return this.documentosService.obtenerDetalleDocumento(documentoId, supervisorId);
  }

  asignarDocumentoASupervisoresAutomaticamente(documentoId: string) {
    return this.documentosService.asignarDocumentoASupervisoresAutomaticamente(documentoId);
  }

  onDocumentoCambiaEstado(documentoId: string, nuevoEstado: string) {
    return this.documentosService.onDocumentoCambiaEstado(documentoId, nuevoEstado);
  }

  asignarTodosDocumentosASupervisores() {
    return this.documentosService.asignarTodosDocumentosASupervisores();
  }

  obtenerConteoDocumentosRadicados() {
    return this.documentosService.obtenerConteoDocumentosRadicados();
  }

  // Revisión
  revisarDocumento(documentoId: string, supervisorId: string, revisarDto: any, archivoSupervisor?: any, pazSalvoArchivo?: any) {
    return this.revisionService.revisarDocumento(documentoId, supervisorId, revisarDto, archivoSupervisor, pazSalvoArchivo);
  }

  corregirDatosInconsistentes() {
    return this.revisionService.corregirDatosInconsistentes();
  }

  devolverDocumento(documentoId: string, supervisorId: string, motivo: string, instrucciones: string) {
    return this.revisionService.devolverDocumento(documentoId, supervisorId, motivo, instrucciones);
  }

  // Archivos
  descargarArchivoRadicado(documentoId: string, numeroArchivo: number, userId: string) {
    return this.archivosService.descargarArchivoRadicado(documentoId, numeroArchivo, userId);
  }

  obtenerArchivoPazSalvo(supervisorId: string, nombreArchivo: string) {
    return this.archivosService.obtenerArchivoPazSalvo(supervisorId, nombreArchivo);
  }

  obtenerArchivoSupervisor(supervisorId: string, nombreArchivo: string) {
    return this.archivosService.obtenerArchivoSupervisor(supervisorId, nombreArchivo);
  }

  // Estadísticas
  obtenerHistorialSupervisor(supervisorId: string) {
    return this.estadisticasService.obtenerHistorialSupervisor(supervisorId);
  }

  obtenerEstadisticasSupervisor(supervisorId: string) {
    return this.estadisticasService.obtenerEstadisticasSupervisor(supervisorId);
  }

  verificarInconsistencias() {
    return this.estadisticasService.verificarInconsistencias();
  }
}