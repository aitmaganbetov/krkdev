// Роли (как ROLE_* в backend/services/auth_service.py).
// Суперадминистратор имеет все права: проходит любую проверку ролей, как require_roles на бэкенде.
export const SUPERADMIN = 'superadmin'

export const isSuperadmin = (role) => role === SUPERADMIN

// Права администратора (рабочая область, дашборд, справочник, пользователи) есть и у суперадминистратора
export const isAdmin = (role) => role === 'admin' || role === SUPERADMIN

export const roleAllowed = (role, allowedRoles = []) => {
  const normalized = String(role || '').toLowerCase()
  return normalized === SUPERADMIN || allowedRoles.map((r) => String(r).toLowerCase()).includes(normalized)
}

// Рабочая область «как у администратора»: деканат выполняет те же действия, но только по своему
// факультету — ограничение проверяет бэкенд (services/faculty_scope.py)
// Проводят проверки занятий и видят только свои записи КРК (как RECORD_AUTHOR_ROLES в auth_service.py):
// сотрудник и член комитета ректорского контроля
export const RECORD_AUTHOR_ROLES = ['staff', 'committee']
export const isRecordAuthor = (role) => RECORD_AUTHOR_ROLES.includes(role)

export const isDean = (role) => role === 'dean'
export const managesWorkspace = (role) => isAdmin(role) || isDean(role)

// Факультеты справочника Platonus для выбора в формах: деканату — только свой
export const deanFaculties = (faculties, role, facultyId) => (
  isDean(role) && facultyId
    ? (faculties || []).filter((faculty) => Number(faculty.id) === Number(facultyId))
    : (faculties || [])
)
