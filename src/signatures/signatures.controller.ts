// src/signatures/signatures.controller.ts
import {
  Controller,
  Post,
  Get,
  Delete,
  UseInterceptors,
  UploadedFile,
  Body,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express'; // ← import type para evitar TS1272
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SignatureRoleGuard } from './guards/signature-role.guard';
import { SignaturesService } from './signatures.service';
import { CreateSignatureDto } from './dto/create-signature.dto';
import { NotFoundException } from '@nestjs/common'; // ← IMPORTAR AQUÍ

interface RequestWithUser extends Request {
  user: {
    id: string;
    username: string;
    role: string;
    email: string;
  };
}

@Controller('signatures')
@UseGuards(JwtAuthGuard)
export class SignaturesController {
  constructor(private readonly signaturesService: SignaturesService) {}

  @Get('my-signature')
  async getMySignature(@Req() req: RequestWithUser) {
    return this.signaturesService.getMySignature(req.user.id);
  }

  @Post('upload')
  @UseGuards(SignatureRoleGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadSignature(
    @Req() req: RequestWithUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() createSignatureDto: CreateSignatureDto,
  ) {
    return this.signaturesService.uploadSignature(
      req.user.id,
      file,
      createSignatureDto.name,
    );
  }

  @Delete('delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSignature(@Req() req: RequestWithUser) {
    await this.signaturesService.deleteSignature(req.user.id);
  }

  @Get('has-signature')
  async hasSignature(@Req() req: RequestWithUser) {
    const has = await this.signaturesService.hasSignature(req.user.id);
    return { has };
  }

  @Get('view')
  async viewSignature(@Req() req: RequestWithUser, @Res() res: Response) {
    console.log(`[VIEW] Solicitud de firma para usuario: ${req.user.id}`);

    try {
      const signature = await this.signaturesService.getSignatureForSigning(req.user.id);

      res.setHeader('Content-Type', signature.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="firma.${signature.type === 'pdf' ? 'pdf' : 'png'}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      res.send(signature.buffer);
    } catch (error) {
      console.error('[VIEW] Error al servir firma:', error.message);
      if (error instanceof NotFoundException) {
        res.status(HttpStatus.NOT_FOUND).json({ message: 'No tienes una firma registrada' });
      } else {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Error al cargar la firma' });
      }
    }
  }
}