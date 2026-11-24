import { Link, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { useTranslation } from "react-i18next"
import { useLocalStorage } from "@/hooks/useLocalStorage"
import {
  // BookOpen, PersonStanding: used only by the hidden Texts/Persons cards below.
  // BookOpen,
  // PersonStanding,
  Plus,
  Library,
  CopyCheck,
  ListChecks,
  UserSearch,
  Users,
  Code2,
} from "lucide-react"
import { usePermission } from "@/hooks/usePermission"
import PermissionButton from "@/components/PermissionButton"
import { useUser } from "@/hooks/useUser"
import { hasOutlineFixAccess } from "@/features/outline-fix/utils"
import { hasAuthorIdAccess } from "@/features/author-identification/access/utils"

const Index = () => {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [, setEditedContent] = useLocalStorage("editedContent", "")
  const { data: permission, isFetching: isFetchingPermission } = usePermission()
  const isAdmin = permission?.role === "admin"
  const { user } = useUser()

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col gap-12">
      {/* Header: headline + tagline + Create (no gradient) */}
      <section className="container mx-auto px-4 pt-10 pb-8 sm:pt-14 sm:pb-10">
        <div className=" mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              {t("home.heroHeadline")}
            </h1>
            <p className="mt-3 text-gray-600 sm:text-lg max-w-2xl">
              {t("home.heroTagline")}
            </p>
          </div>
          {isAdmin && (
            <Button
              size="lg"
              onClick={() => {
                setEditedContent("")
                navigate("/create")
              }}
              disabled={!isAdmin}
              className="shrink-0 bg-[var(--color-primary)] hover:bg-[var(--color-primary)]/90 text-white cursor-pointer"
            >
              <PermissionButton
                isLoading={isFetchingPermission}
                icon={<Plus className="w-5 h-5" />}
                text={t("common.create")}
              />
            </Button>
          )}
        </div>
      </section>

      {/* Feature descriptions (informational only, no links) */}
      <section className="container mx-auto px-4 flex-1">
        <div className="max-w-6xl h-max  grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          {/* Hidden for now: Texts and Persons are not shown in the Cataloger.
          <Link
              to="/texts"
            >

          <div className="flex h-full items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all duration-200 hover:border-[var(--color-primary)]/50 hover:shadow-md">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 text-[var(--color-primary)]">
              <BookOpen className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold text-gray-900">
                {t("home.featureTextsTitle")}
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                {t("home.featureTextsDescription")}
              </p>
            </div>
          </div>
          </Link>

          <Link
              to="/persons"
            >
          <div className="flex h-full items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all duration-200 hover:border-[var(--color-secondary)]/50 hover:shadow-md">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-[var(--color-secondary)]/30 bg-[var(--color-secondary)]/10 text-[var(--color-secondary)]">
              <PersonStanding className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold text-gray-900">
                {t("home.featurePersonsTitle")}
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                {t("home.featurePersonsDescription")}
              </p>
            </div>
          </div>
          </Link>
          */}
          <Link
              to="/outliner"
            >
          <div className="flex h-full items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all duration-200  hover:shadow-md">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border ">
              <Library className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold text-gray-900">
                {t("home.featureOutlinerTitle")}
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                {t("home.featureOutlinerDescription")}
              </p>
            </div>
          </div>
          </Link>
          <Link
              to="/dedup"
            >
          <div className="flex h-full items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all duration-200  hover:shadow-md">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border ">
              <CopyCheck className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold text-gray-900">
                {t("home.featureDeduplicatorTitle")}
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                {t("home.featureDeduplicatorDescription")}
              </p>
            </div>
          </div>
          </Link>
          {/* Shown to Outline Fixer users only, as its nav tab is. */}
          {hasOutlineFixAccess(user) && (
          <Link
              to="/outline-fix"
            >
          <div className="flex h-full items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all duration-200  hover:shadow-md">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border ">
              <ListChecks className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold text-gray-900">
                {t("home.featureOutlineFixerTitle")}
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                {t("home.featureOutlineFixerDescription")}
              </p>
            </div>
          </div>
          </Link>
          )}
          {/* Shown to Author Identification users only, as its nav tab is. */}
          {hasAuthorIdAccess(user) && (
          <Link
              to="/author-identification"
            >
          <div className="flex h-full items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all duration-200  hover:shadow-md">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border ">
              <UserSearch className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold text-gray-900">
                {t("home.featureAuthorIdentificationTitle")}
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                {t("home.featureAuthorIdentificationDescription")}
              </p>
            </div>
          </div>
          </Link>
          )}
        </div>
      </section>

   
    </div>
  )
}

export default Index
