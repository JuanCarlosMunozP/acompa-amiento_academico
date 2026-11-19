import { authFetch } from './authFetch';

export type ClavePlantillaCorreo = 'asignacion_tutor' | 'asignacion_estudiante';

export type PlantillaCorreoPlan = {
  clave: ClavePlantillaCorreo;
  asunto: string;
  cuerpo_texto: string;
  cuerpo_html: string;
  actualizado: string;
};

export const listarPlantillasCorreo = () => authFetch<PlantillaCorreoPlan[]>('/plantillas-correo/');

export const guardarPlantillaCorreo = (
  clave: ClavePlantillaCorreo,
  cambios: Pick<PlantillaCorreoPlan, 'asunto' | 'cuerpo_texto' | 'cuerpo_html'>,
) =>
  authFetch<PlantillaCorreoPlan>(`/plantillas-correo/${clave}/`, {
    method: 'PATCH',
    body: JSON.stringify(cambios),
  });
